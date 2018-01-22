/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {PositionStrategy} from './position-strategy';
import {ElementRef} from '@angular/core';
import {ViewportRuler, CdkScrollable} from '@angular/cdk/scrolling';
import {
  ConnectedOverlayPositionChange,
  ConnectionPositionPair,
  ScrollingVisibility,
} from './connected-position';
import {Subject} from 'rxjs/Subject';
import {Subscription} from 'rxjs/Subscription';
import {Observable} from 'rxjs/Observable';
import {OverlayRef} from '../overlay-ref';
import {isElementScrolledOutsideView, isElementClippedByScrolling} from './scroll-clip';


// TODO: refactor clipping detection into a separate thing (part of scrolling module)
// TODO: attribute selector to specify the transform-origin inside the overlay content
// TODO: flexible position + centering doesn't work on IE11 (works on Edge).
// TODO: doesn't handle both flexible width and height when it has to scroll along both axis.

/**
 * A strategy for positioning overlays. Using this strategy, an overlay is given an
 * implicit position relative some origin element. The relative position is defined in terms of
 * a point on the origin element that is connected to a point on the overlay element. For example,
 * a basic dropdown is connecting the bottom-left corner of the origin to the top-left corner
 * of the overlay.
 */
export class FlexibleConnectedPositionStrategy implements PositionStrategy {
  /** The overlay to which this strategy is attached. */
  private _overlayRef: OverlayRef;

  /** Whether we're performing the very first positioning of the overlay. */
  private _isInitialRender = true;

  /** Last size used for the bounding box. Used to avoid resizing the overlay after open. */
  private _lastBoundingBoxSize = {width: 0, height: 0};

  /** Whether the overlay was pushed in a previous positioning. */
  private _isPushed = false;

  /** Whether the overlay can be pushed on-screen on the initial open. */
  private _canPush = true;

  /** Whether the overlay can grow via flexible width/height after the initial open. */
  private _growAfterOpen = false;

  /** Whether the overlay's height can be constrained to fit within the viewport. */
  private _hasFlexibleHeight = true;

  /** Whether the overlay's width can be constrained to fit within the viewport. */
  private _hasFlexibleWidth = true;

  /** Whether the overlay position is locked. */
  private _positionLocked = false;

  /** Cached origin dimensions */
  private _originRect: ClientRect;

  /** Cached overlay dimensions */
  private _overlayRect: ClientRect;

  /** Cached viewport dimensions */
  private _viewportRect: ClientRect;

  /** Amount of space that must be maintained between the overlay and the edge of the viewport. */
  private _viewportMargin: number = 0;

  /** The Scrollable containers used to check scrollable view properties on position change. */
  private scrollables: CdkScrollable[] = [];

  /** Ordered list of preferred positions, from most to least desirable. */
  _preferredPositions: ConnectionPositionPair[] = [];

  /** The origin element against which the overlay will be positioned. */
  private _origin: HTMLElement;

  /** The overlay pane element. */
  private _pane: HTMLElement;

  /** Whether the strategy has been disposed of already. */
  private _isDisposed: boolean;

  /**
   * Parent element for the overlay panel used to constrain the overlay panel's size to fit
   * within the viewport.
   */
  private _boundingBox: HTMLElement | null;

  /** The last position to have been calculated as the best fit position. */
  private _lastPosition: ConnectedPosition;

  /** Subject that emits whenever the position changes. */
  private _positionChanges = new Subject<ConnectedOverlayPositionChange>();

  /** Subscription to viewport size changes. */
  private _resizeSubscription = Subscription.EMPTY;

  /** Observable sequence of position changes. */
  positionChanges: Observable<ConnectedOverlayPositionChange> =
      this._positionChanges.asObservable();

  /** Ordered list of preferred positions, from most to least desirable. */
  get positions() {
    return this._preferredPositions;
  }

  constructor(
    private _connectedTo: ElementRef,
    private _viewportRuler: ViewportRuler,
    private _document: Document) {
    this._origin = this._connectedTo.nativeElement;
  }

  /** Attaches this position strategy to an overlay. */
  attach(overlayRef: OverlayRef): void {
    if (this._overlayRef && overlayRef !== this._overlayRef) {
      throw Error('This position strategy is already attached to an overlay');
    }

    overlayRef.hostElement.classList.add('cdk-overlay-connected-position-bounding-box');

    this._overlayRef = overlayRef;
    this._boundingBox = overlayRef.hostElement!;
    this._pane = overlayRef.overlayElement;
    this._resizeSubscription.unsubscribe();
    this._resizeSubscription = this._viewportRuler.change().subscribe(() => this.apply());
  }

  /**
   * Updates the position of the overlay element, using whichever preferred position relative
   * to the origin best fits on-screen.
   *
   * The selection of a position goes as follows:
   *  - If any positions fit completely within the viewport as-is,
   *      choose the first position that does so.
   *  - If flexible dimensions are enabled and at least one satifies the given minimum width/height,
   *      choose the position with the greatest available size modified by the positions' weight.
   *  - If pushing is enabled, take the position that went off-screen the least and push it
   *      on-screen.
   *  - If none of the previous criteria were met, use the position that goes off-screen the least.
   * @docs-private
   */
  apply(): void {
    // We shouldn't do anything if the strategy was disposed.
    if (this._isDisposed) {
      return;
    }

    // If the position has been applied already (e.g. when the overlay was opened) and the
    // consumer opted into locking in the position, re-use the old position, in order to
    // prevent the overlay from jumping around.
    if (!this._isInitialRender && this._positionLocked && this._lastPosition) {
      this.reapplyLastPosition();
      return;
    }

    this._resetBoundingBoxStyles();

    // We need the bounding rects for the origin and the overlay to determine how to position
    // the overlay relative to the origin.
    // We use the viewport rect to determine whether a position would go off-screen.
    this._viewportRect = this._getNarrowedViewportRect();
    this._originRect = this._origin.getBoundingClientRect();
    this._overlayRect = this._pane.getBoundingClientRect();

    const originRect = this._originRect;
    const overlayRect = this._overlayRect;
    const viewportRect = this._viewportRect;

    // Positions where the overlay will fit with flexible dimensions.
    const flexibleFits: FlexibleFit[] = [];

    // Fallback if none of the preferred positions fit within the viewport.
    let fallback: FallbackPosition | undefined;

    // Go through each of the preferred positions looking for a good fit.
    // If a good fit is found, it will be applied immediately.
    for (let pos of this._preferredPositions) {
      // Get the exact (x, y) coordinate for the point-of-origin on the origin element.
      let originPoint = this._getOriginPoint(originRect, pos);

      // From that point-of-origin, get the exact (x, y) coordinate for the top-left corner of the
      // overlay in this position. We use the top-left corner for calculations and later translate
      // this into an appropriate (top, left, bottom, right) style.
      let overlayPoint = this._getOverlayPoint(originPoint, overlayRect, pos);

      // Calculate how well the overlay would fit into the viewport with this point.
      let overlayFit = this._getOverlayFit(overlayPoint, overlayRect, viewportRect, pos);

      // If the overlay, without any further work, fits into the viewport, use this position.
      if (overlayFit.isCompletelyWithinViewport) {
        this._isPushed = false;
        this._applyPosition(pos, originPoint);
        return;
      }

      // If the overlay has flexible dimensions, we can use this position
      // so long as there's enough space for the minimum dimensions.
      if (this._canFitWithFlexibleDimensions(overlayFit, overlayPoint, viewportRect)) {
        // Save positions where the overlay will fit with flexible dimensions. We will use these
        // if none of the positions fit *without* flexible dimensions.
        flexibleFits.push({
          position: pos,
          origin: originPoint,
          overlayRect,
          boundingBoxRect: this._calculateBoundingBoxRect(originPoint, pos)
        });

        continue;
      }

      // If the current preferred position does not fit on the screen, remember the position
      // if it has more visible area on-screen than we've seen and move onto the next preferred
      // position.
      if (!fallback || fallback.overlayFit.visibleArea < overlayFit.visibleArea) {
        fallback = {overlayFit, overlayPoint, originPoint, position: pos, overlayRect};
      }
    }

    // If there are any positions where the overlay would fit with flexible dimensions, choose the
    // one that has the greatest area available modified by the position's weight
    if (flexibleFits.length) {
      let bestFit: FlexibleFit | null = null;
      let bestScore = -1;
      for (const fit of flexibleFits) {
        const score =
            fit.boundingBoxRect.width * fit.boundingBoxRect.height * (fit.position.weight || 1);
        if (score > bestScore) {
          bestScore = score;
          bestFit = fit;
        }
      }

      this._isPushed = false;
      this._applyPosition(bestFit!.position, bestFit!.origin);
      return;
    }

    // When none of the preferred positions fit within the viewport, take the position
    // that went off-screen the least and attempt to push it on-screen.
    if (this._canPush) {
      // TODO(jelbourn): after pushing, the opening "direction" of the overlay might not make sense.
      this._isPushed = true;
      this._applyPosition(fallback!.position, fallback!.originPoint);
      return;
    }

    // All options for getting the overlay within the viewport have been exhausted, so go with the
    // position that went off-screen the least.
    this._applyPosition(fallback!.position, fallback!.originPoint);
  }

  detach() {
    this._resizeSubscription.unsubscribe();
  }

  /** Cleanup after the element gets destroyed. */
  dispose() {
    if (!this._isDisposed) {
      this.detach();
      this._boundingBox = null;
      this._positionChanges.complete();
      this._isDisposed = true;
    }
  }

  /**
   * This re-aligns the overlay element with the trigger in its last calculated position,
   * even if a position higher in the "preferred positions" list would now fit. This
   * allows one to re-align the panel without changing the orientation of the panel.
   */
  reapplyLastPosition(): void {
    if (!this._isDisposed) {
      this._originRect = this._origin.getBoundingClientRect();
      this._overlayRect = this._pane.getBoundingClientRect();
      this._viewportRect = this._getNarrowedViewportRect();

      const lastPosition = this._lastPosition || this._preferredPositions[0];
      const originPoint = this._getOriginPoint(this._originRect, lastPosition);

      this._applyPosition(lastPosition, originPoint);
    }
  }

  /**
   * Sets the list of Scrollable containers that host the origin element so that
   * on reposition we can evaluate if it or the overlay has been clipped or outside view. Every
   * Scrollable must be an ancestor element of the strategy's origin element.
   */
  withScrollableContainers(scrollables: CdkScrollable[]) {
    this.scrollables = scrollables;
  }

  /**
   * Adds a new preferred fallback position.
   * @param positions List of positions options for this overlay.
   */
  withPositions(positions: ConnectedPosition[]): this {
    this._preferredPositions = positions;
    return this;
  }

  /**
   * Sets a minimum distance the ovelray may be positioned to the edge of the viewport.
   * @param margin Required margin between the overlay and the viewport edge in pixels.
   */
  withViewportMargin(margin: number): this {
    this._viewportMargin = margin;
    return this;
  }

  /** Sets whether the overlay's height can be constrained to fit within the viewport. */
  withFlexibleHeight(flexibleHeight = true): this {
    this._hasFlexibleHeight = flexibleHeight;
    return this;
  }

  /** Sets whether the overlay's width can be constrained to fit within the viewport. */
  withFlexibleWidth(flexibleWidth = true): this {
    this._hasFlexibleWidth = flexibleWidth;
    return this;
  }

  /** Sets whether the overlay can grow after the initial open via flexible width/height. */
  withGrowAfterOpen(growAfterOpen = true): this {
    this._growAfterOpen = growAfterOpen;
    return this;
  }

  /** Sets whether the overlay can be pushed on-screen if none of the provided positions fit. */
  withPush(canPush = true): this {
    this._canPush = canPush;
    return this;
  }

  /**
   * Sets whether the overlay's position should be locked in after it is positioned
   * initially. When an overlay is locked in, it won't attempt to reposition itself
   * when the position is re-applied (e.g. when the user scrolls away).
   * @param isLocked Whether the overlay should locked in.
   */
  withLockedPosition(isLocked = true): this {
    this._positionLocked = isLocked;
    return this;
  }

  /**
   * Gets the (x, y) coordinate of a connection point on the origin based on a relative position.
   */
  private _getOriginPoint(originRect: ClientRect, pos: ConnectedPosition): Point {
    let x: number;
    if (pos.originX == 'center') {
      // Note: when centering we should always use the `left`
      // offset, otherwise the position will be wrong in RTL.
      x = originRect.left + (originRect.width / 2);
    } else {
      const startX = this._isRtl() ? originRect.right : originRect.left;
      const endX = this._isRtl() ? originRect.left : originRect.right;
      x = pos.originX == 'start' ? startX : endX;
    }

    let y: number;
    if (pos.originY == 'center') {
      y = originRect.top + (originRect.height / 2);
    } else {
      y = pos.originY == 'top' ? originRect.top : originRect.bottom;
    }

    return {x, y};
  }


  /**
   * Gets the (x, y) coordinate of the top-left corner of the overlay given a given position and
   * origin point to which the overlay should be connected.
   */
  private _getOverlayPoint(
      originPoint: Point,
      overlayRect: ClientRect,
      pos: ConnectedPosition): Point {

    // Calculate the (overlayStartX, overlayStartY), the start of the
    // potential overlay position relative to the origin point.
    let overlayStartX: number;
    if (pos.overlayX == 'center') {
      overlayStartX = -overlayRect.width / 2;
    } else if (pos.overlayX === 'start') {
      overlayStartX = this._isRtl() ? -overlayRect.width : 0;
    } else {
      overlayStartX = this._isRtl() ? 0 : -overlayRect.width;
    }

    let overlayStartY: number;
    if (pos.overlayY == 'center') {
      overlayStartY = -overlayRect.height / 2;
    } else {
      overlayStartY = pos.overlayY == 'top' ? 0 : -overlayRect.height;
    }

    // The (x, y) coordinates of the overlay.
    return {
      x: originPoint.x + overlayStartX,
      y: originPoint.y + overlayStartY,
    };
  }

  /** Gets how well an overlay at the given point will fit within the viewport. */
  private _getOverlayFit(point: Point, overlay: ClientRect, viewport: ClientRect,
    position: ConnectedPosition): OverlayFit {

    let {x, y} = point;

    // Account for the offsets since they could push the overlay out of the viewport.
    if (position.offsetX) {
      x += position.offsetX;
    }

    if (position.offsetY) {
      y += position.offsetY;
    }

    // How much the overlay would overflow at this position, on each side.
    let leftOverflow = 0 - x;
    let rightOverflow = (x + overlay.width) - viewport.width;
    let topOverflow = 0 - y;
    let bottomOverflow = (y + overlay.height) - viewport.height;

    // Visible parts of the element on each axis.
    let visibleWidth = this._subtractOverflows(overlay.width, leftOverflow, rightOverflow);
    let visibleHeight = this._subtractOverflows(overlay.height, topOverflow, bottomOverflow);
    let visibleArea = visibleWidth * visibleHeight;

    return {
      visibleArea,
      isCompletelyWithinViewport: (overlay.width * overlay.height) === visibleArea,
      fitsInViewportVertically: visibleHeight === overlay.height,
      fitsInViewportHorizontally: visibleWidth == overlay.width,
    };
  }

  /**
   * Whether the overlay can fit within the viewport when it may resize either its width or height.
   * @param fit How well the overlay fits in the viewport at some position.
   * @param point The (x, y) coordinates of the overlat at some position.
   * @param viewport The geometry of the viewport.
   */
  private _canFitWithFlexibleDimensions(fit: OverlayFit, point: Point, viewport: ClientRect) {
    if (this._hasFlexibleWidth || this._hasFlexibleWidth) {
      const availableHeight = viewport.bottom - point.y;
      const availableWidth = viewport.right - point.x;
      const minHeight = this._overlayRef.getConfig().minHeight || 0;
      const minWidth = this._overlayRef.getConfig().minWidth || 0;

      const verticalFit = fit.fitsInViewportVertically ||
          (this._hasFlexibleHeight && minHeight <= availableHeight);
      const horizontalFit = fit.fitsInViewportHorizontally ||
          (this._hasFlexibleWidth && minWidth <= availableWidth);

      return verticalFit && horizontalFit;
    }
  }

  /**
   * Gets the point at which the overlay can be "pushed" on-screen. If the overlay is larger than
   * the viewport, the top-left corner will be pushed on-screen (with overflow occuring on the
   * right and bottom).
   *
   * @param start The starting point from which the overlay is pushed.
   * @param overlay The overlay dimensions.
   * @returns The point at which to position the overlay after pushing. This is effectively a new
   *     originPoint.
   */
  private _pushOverlayOnScreen(start: Point, overlay: ClientRect): Point {
    const viewport = this._viewportRect;

    // Determine how much the overlay goes outside the viewport on each side, which we'll use to
    // decide which direction to push it.
    const overflowRight = Math.max(start.x + overlay.width - viewport.right, 0);
    const overflowBottom = Math.max(start.y + overlay.height - viewport.bottom, 0);
    const overflowTop = Math.max(viewport.top - start.y, 0);
    const overflowLeft = Math.max(viewport.left - start.x, 0);

    // Amount by which to push the overlay in each direction such that it remains on-screen.
    let pushX, pushY = 0;

    // If the overlay fits completely within the bounds of the viewport, push it from whichever
    // direction is goes off-screen. Otherwise, push the top-left corner such that its in the
    // viewport and allow for the trailing end of the overlay to go out of bounds.
    if (overlay.width <= viewport.width) {
      pushX = overflowLeft || -overflowRight;
    } else {
      pushX = viewport.left - start.x;
    }

    if (overlay.height <= viewport.height) {
      pushY = overflowTop || -overflowBottom;
    } else {
      pushY = viewport.top - start.y;
    }

    return {
      x: start.x + pushX,
      y: start.y + pushY,
    };
  }

  /**
   * Applies a computed position to the overlay and emits a position change.
   *
   * @param position The position preference
   * @param originPoint The point on the origin element where the overlay is connected.
   */
  private _applyPosition(position: ConnectedPosition, originPoint: Point) {
    this._setOverlayElementStyles(originPoint, position);
    this._setBoundingBoxStyles(originPoint, position);

    // Save the last connected position in case the position needs to be re-calculated.
    this._lastPosition = position;

    // Notify that the position has been changed along with its change properties.
    const scrollableViewProperties = this._getScrollVisibility();
    const changeEvent = new ConnectedOverlayPositionChange(position, scrollableViewProperties);
    this._positionChanges.next(changeEvent);
    this._isInitialRender = false;
  }

  /**
   * Gets the position and size of the overlay's sizing container.
   *
   * This method does no measuring and applies no styles so that we can cheaply compute the
   * bounds for all positions and choose the best fit based on these results.
   */
  private _calculateBoundingBoxRect(origin: Point, position: ConnectedPosition): BoundingBoxRect {
    const viewport = this._viewportRect;
    let height, top, bottom;

    if (position.overlayY === 'top') {
      // Overlay is opening "downward" and thus is bound by the bottom viewport edge.
      top = origin.y;
      height = viewport.bottom - origin.y;
    } else if (position.overlayY === 'bottom') {
      // Overlay is opening "upward" and thus is bound by the top viewport edge.
      bottom = viewport.bottom - origin.y + this._viewportMargin;
      height = origin.y - viewport.top;
    } else {
      // If neither top nor bottom, it means that the overlay
      // is vertically centered on the origin point.
      const smallestDistanceToViewportEdge =
          Math.min(viewport.bottom - origin.y, origin.y - viewport.left);
      const previousHeight = this._lastBoundingBoxSize.height;

      height = smallestDistanceToViewportEdge * 2;
      top = origin.y - smallestDistanceToViewportEdge;

      if (height > previousHeight && !this._isInitialRender && !this._growAfterOpen) {
        top = origin.y - (previousHeight / 2);
      }
    }

    // The overlay is opening 'right-ward' (the content flows to the right).
    const isBoundedByRightViewportEdge =
        (position.overlayX === 'start' && !this._isRtl()) ||
        (position.overlayX === 'end' && this._isRtl());

    // The overlay is opening 'left-ward' (the content flows to the left).
    const isBoundedByLeftViewportEdge =
        (position.overlayX === 'end' && !this._isRtl()) ||
        (position.overlayX === 'start' && this._isRtl());

    let width, left, right;

    if (isBoundedByLeftViewportEdge) {
      right = viewport.right - origin.x + this._viewportMargin;
      width = origin.x - viewport.left;
    } else if (isBoundedByRightViewportEdge) {
      left = origin.x;
      width = viewport.right - origin.x;
    } else {
      // If neither start nor end, it means that the overlay
      // is horizontally centered on the origin point.
      const smallestDistanceToViewportEdge =
          Math.min(viewport.right - origin.x, origin.x - viewport.top);
      const previousWidth = this._lastBoundingBoxSize.width;

      width = smallestDistanceToViewportEdge * 2;
      left = origin.x - smallestDistanceToViewportEdge;

      if (width > previousWidth && !this._isInitialRender && !this._growAfterOpen) {
        left = origin.x - (previousWidth / 2);
      }
    }

    return {top, left, bottom, right, width, height};
  }

  /**
   * Sets the position and size of the overlay's sizing wrapper. The wrapper is positioned on the
   * origin's connection point and stetches to the bounds of the viewport.
   *
   * @param origin The point on the origin element where the overlay is connected.
   * @param position The position preference
   */
  private _setBoundingBoxStyles(origin: Point, position: ConnectedPosition): void {
    const boundingBoxRect = this._calculateBoundingBoxRect(origin, position);

    // It's weird if the overlay *grows* while scrolling, so we take the last size into account
    // when applying a new size.
    if (!this._isInitialRender && !this._growAfterOpen) {
      boundingBoxRect.height = Math.min(boundingBoxRect.height, this._lastBoundingBoxSize.height);
      boundingBoxRect.width = Math.min(boundingBoxRect.width, this._lastBoundingBoxSize.width);
    }

    const styles = {} as CSSStyleDeclaration;

    if (!this._hasFlexibleHeight || this._isPushed) {
      styles.top = '0';
      styles.bottom = '';
      styles.height = '100%';
    } else {
      styles.height = `${boundingBoxRect.height}px`;
      styles.top = boundingBoxRect.top ? `${boundingBoxRect.top}px` : '';
      styles.bottom = boundingBoxRect.bottom ? `${boundingBoxRect.bottom}px` : '';
    }

    if (!this._hasFlexibleWidth || this._isPushed) {
      styles.left = '0';
      styles.right = '';
      styles.width = '100%';
    } else {
      styles.width = `${boundingBoxRect.width}px`;
      styles.left = boundingBoxRect.left ? `${boundingBoxRect.left}px` : '';
      styles.right = boundingBoxRect.right ? `${boundingBoxRect.right}px` : '';
    }

    const maxHeight = this._overlayRef.getConfig().maxHeight;
    if (maxHeight && this._hasFlexibleHeight) {
      styles.maxHeight = formatCssUnit(maxHeight);
    }

    const maxWidth = this._overlayRef.getConfig().maxWidth;
    if (maxWidth && this._hasFlexibleWidth) {
      styles.maxWidth = formatCssUnit(maxWidth);
    }

    this._lastBoundingBoxSize = boundingBoxRect;

    extendStyles(this._boundingBox!.style, styles);
  }

  /** Resets the styles for the bounding box so that a new positioning can be computed. */
  private _resetBoundingBoxStyles() {
    extendStyles(this._boundingBox!.style, {
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      height: '',
      width: '',
      alignItems: '',
      justifyContent: '',
    } as CSSStyleDeclaration);
  }

  /** Sets positioning styles to the overlay element. */
  private _setOverlayElementStyles(originPoint: Point, position: ConnectedPosition): void {
    // Reset styles from any previous positioning.
    const styles = {
      top: '',
      left: '',
      bottom: '',
      right: '',
    } as CSSStyleDeclaration;

    // Align the overlay panel to the appropriate edge of the
    // size-constraining container unless using a 'center' position.
    if (this._hasFlexibleWidth && position.overlayX !== 'center' && !this._isPushed) {
      if (this._isRtl()) {
        styles[position.overlayX === 'end' ? 'left' : 'right'] = '0';
      } else {
        styles[position.overlayX === 'end' ? 'right' : 'left'] = '0';
      }
    }

    if (this._hasFlexibleHeight && position.overlayY !== 'center' && !this._isPushed) {
      styles[position.overlayY === 'bottom' ? 'bottom' : 'top'] = '0';
    }

    if (!this._hasFlexibleHeight || this._isPushed) {
      extendStyles(styles, this._getExactOverlayY(position, originPoint));
    }

    if (!this._hasFlexibleWidth || this._isPushed) {
      extendStyles(styles, this._getExactOverlayX(position, originPoint));
    }

    // Use a transform to apply the offsets. We do this because the `center` positions rely on
    // being in the normal flex flow and setting a `top` / `left` at all will completely throw
    // off the position. We also can't use margins, because they won't have an effect in some
    // cases where the element doesn't have anything to "push off of". Finally, this works
    // better both with flexible and non-flexible positioning.
    let transformString = ' ';

    if (position.offsetX) {
      transformString += `translateX(${position.offsetX}px)`;
    }

    if (position.offsetY) {
      transformString += `translateY(${position.offsetY}px)`;
    }

    styles.transform = transformString.trim();

    // If a maxWidth or maxHeight is specified on the overlay, we remove them. We do this because
    // we need these values to both be set to "100%" for the automatic flexible sizing to work.
    // The maxHeight and maxWidth are set on the boundingBox in order to enforce the constraint.
    if (this._hasFlexibleHeight && this._overlayRef.getConfig().maxHeight) {
      styles.maxHeight = '';
    }

    if (this._hasFlexibleWidth && this._overlayRef.getConfig().maxWidth) {
      styles.maxWidth = '';
    }

    // Push the pane content towards the proper direction.
    if (position.overlayX === 'center') {
      styles.justifyContent = 'center';
    } else {
      styles.justifyContent = position.overlayX === 'end' ? 'flex-end' : 'flex-start';
    }

    extendStyles(this._pane.style, styles);
  }

  /** Gets the exact top/bottom for the overlay when not using flexible sizing or when pushing. */
  private _getExactOverlayY(position: ConnectedPosition, originPoint: Point) {
    // Reset any existing styles. This is necessary in case the
    // preferred position has changed since the last `apply`.
    let styles = {top: null, bottom: null} as CSSStyleDeclaration;
    let overlayPoint = this._getOverlayPoint(originPoint, this._overlayRect, position);

    if (this._isPushed) {
      overlayPoint = this._pushOverlayOnScreen(overlayPoint, this._overlayRect);
    }

    // We want to set either `top` or `bottom` based on whether the overlay wants to appear
    // above or below the origin and the direction in which the element will expand.
    if (position.overlayY === 'bottom') {
      // When using `bottom`, we adjust the y position such that it is the distance
      // from the bottom of the viewport rather than the top.
      const documentHeight = this._document.documentElement.clientHeight;
      styles.bottom = `${documentHeight - (overlayPoint.y + this._overlayRect.height)}px`;
    } else {
      styles.top = `${overlayPoint.y}px`;
    }

    return styles;
  }

  /** Gets the exact left/right for the overlay when not using flexible sizing or when pushing. */
  private _getExactOverlayX(position: ConnectedPosition, originPoint: Point) {
    // Reset any existing styles. This is necessary in case the preferred position has
    // changed since the last `apply`.
    let styles = {left: null, right: null} as CSSStyleDeclaration;
    let overlayPoint = this._getOverlayPoint(originPoint, this._overlayRect, position);

    if (this._isPushed) {
      overlayPoint = this._pushOverlayOnScreen(overlayPoint, this._overlayRect);
    }

    // We want to set either `left` or `right` based on whether the overlay wants to appear "before"
    // or "after" the origin, which determines the direction in which the element will expand.
    // For the horizontal axis, the meaning of "before" and "after" change based on whether the
    // page is in RTL or LTR.
    let horizontalStyleProperty: 'left' | 'right';

    if (this._isRtl()) {
      horizontalStyleProperty = position.overlayX === 'end' ? 'left' : 'right';
    } else {
      horizontalStyleProperty = position.overlayX === 'end' ? 'right' : 'left';
    }

    // When we're setting `right`, we adjust the x position such that it is the distance
    // from the right edge of the viewport rather than the left edge.
    if (horizontalStyleProperty === 'right') {
      const documentWidth = this._document.documentElement.clientWidth;
      styles.right = `${documentWidth - (overlayPoint.x + this._overlayRect.width)}px`;
    } else {
      styles.left = `${overlayPoint.x}px`;
    }

    return styles;
  }

  /**
   * Gets the view properties of the trigger and overlay, including whether they are clipped
   * or completely outside the view of any of the strategy's scrollables.
   */
  private _getScrollVisibility(): ScrollingVisibility {
    // Note: needs fresh rects since the position could've changed.
    const originBounds = this._origin.getBoundingClientRect();
    const overlayBounds =  this._pane.getBoundingClientRect();

    // TODO(jelbourn): instead of needing all of the client rects for these scrolling containers
    // every time, we should be able to use the scrollTop of the containers if the size of those
    // containers hasn't changed.
    const scrollContainerBounds = this.scrollables.map(scrollable => {
      return scrollable.getElementRef().nativeElement.getBoundingClientRect();
    });

    return {
      isOriginClipped: isElementClippedByScrolling(originBounds, scrollContainerBounds),
      isOriginOutsideView: isElementScrolledOutsideView(originBounds, scrollContainerBounds),
      isOverlayClipped: isElementClippedByScrolling(overlayBounds, scrollContainerBounds),
      isOverlayOutsideView: isElementScrolledOutsideView(overlayBounds, scrollContainerBounds),
    };
  }

  /** Subtracts the amount that an element is overflowing on an axis from it's length. */
  private _subtractOverflows(length: number, ...overflows: number[]): number {
    return overflows.reduce((currentValue: number, currentOverflow: number) => {
      return currentValue - Math.max(currentOverflow, 0);
    }, length);
  }

  /** Narrows the given viewport rect by the current _viewportMargin. */
  private _getNarrowedViewportRect(): ClientRect {
    // We recalculate the viewport rect here ourselves, rather than using the ViewportRuler,
    // because we want to use the `clientWidth` and `clientHeight` as the base. The difference
    // being that the client properties don't include the scrollbar, as opposed to `innerWidth`
    // and `innerHeight` that do. This is necessary, because the overlay container uses
    // 100% `width` and `height` which don't include the scrollbar either.
    const width = this._document.documentElement.clientWidth;
    const height = this._document.documentElement.clientHeight;
    const scrollPosition = this._viewportRuler.getViewportScrollPosition();

    return {
      top:    scrollPosition.top + this._viewportMargin,
      left:   scrollPosition.left + this._viewportMargin,
      right:  scrollPosition.left + width  - this._viewportMargin,
      bottom: scrollPosition.top + height - this._viewportMargin,
      width:  width  - (2 * this._viewportMargin),
      height: height - (2 * this._viewportMargin),
    };
  }

  /** Whether the we're dealing with an RTL context */
  private _isRtl() {
    return this._overlayRef.getConfig().direction === 'rtl';
  }
}

/** A simple (x, y) coordinate. */
interface Point {
  x: number;
  y: number;
}

/** Record of measurements for how an overlay (at a given position) fits into the viewport. */
interface OverlayFit {
  /** Whether the overlay fits completely in the viewport. */
  isCompletelyWithinViewport: boolean;

  /** Whether the overlay fits in the viewport on the y-axis. */
  fitsInViewportVertically: boolean;

  /** Whether the overlay fits in the viewport on the x-axis. */
  fitsInViewportHorizontally: boolean;

  /** The total visible area (in px^2) of the overlay inside the viewport. */
  visibleArea: number;
}

/** Record of the measurments determining whether an overlay will fit in a specific position. */
interface FallbackPosition {
  position: ConnectedPosition;
  originPoint: Point;
  overlayPoint: Point;
  overlayFit: OverlayFit;
  overlayRect: ClientRect;
}

/** Position and size of the overlay sizing wrapper for a specific position. */
interface BoundingBoxRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  height: number;
  width: number;
}

/** Record of measures determining how well a given position will fit with flexible dimensions. */
interface FlexibleFit {
  position: ConnectedPosition;
  origin: Point;
  overlayRect: ClientRect;
  boundingBoxRect: BoundingBoxRect;
}

/** A connected position as specified by the user. */
export interface ConnectedPosition {
  originX: 'start' | 'center' | 'end';
  originY: 'top' | 'center' | 'bottom';

  overlayX: 'start' | 'center' | 'end';
  overlayY: 'top' | 'center' | 'bottom';

  weight?: number;
  offsetX?: number;
  offsetY?: number;
}

// TODO: move to common place
function formatCssUnit(value: number | string) {
  return typeof value === 'string' ? value as string : `${value}px`;
}

/** Shallow-extends a stylesheet object with another stylesheet object. */
function extendStyles(dest: CSSStyleDeclaration, source: CSSStyleDeclaration): CSSStyleDeclaration {
  for (let key in source) {
    if (source.hasOwnProperty(key)) {
      dest[key] = source[key];
    }
  }

  return dest;
}
