import {ElementRef, NgModule, Component, NgZone} from '@angular/core';
import {TestBed, inject} from '@angular/core/testing';
import {CdkScrollable} from '@angular/cdk/scrolling';
import {PortalModule, ComponentPortal} from '@angular/cdk/portal';
import {Subscription} from 'rxjs/Subscription';
import {map} from 'rxjs/operators/map';
import {ScrollDispatchModule} from '@angular/cdk/scrolling';
import {MockNgZone} from '@angular/cdk/testing';
import {
  OverlayModule,
  Overlay,
  OverlayConfig,
  OverlayRef,
  OverlayContainer,
  FlexibleConnectedPositionStrategy,
  ConnectedOverlayPositionChange,
  ViewportRuler,
} from '../index';

// Default width and height of the overlay and origin panels throughout these tests.
const DEFAULT_HEIGHT = 30;
const DEFAULT_WIDTH = 60;

describe('FlexibleConnectedPositionStrategy', () => {
  let overlay: Overlay;
  let overlayContainer: OverlayContainer;
  let overlayContainerElement: HTMLElement;
  let zone: MockNgZone;
  let overlayRef: OverlayRef;
  let viewport: ViewportRuler;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ScrollDispatchModule, OverlayModule, OverlayTestModule],
      providers: [{provide: NgZone, useFactory: () => zone = new MockNgZone()}]
    });

    inject([Overlay, OverlayContainer, ViewportRuler],
      (o: Overlay, oc: OverlayContainer, v: ViewportRuler) => {
        overlay = o;
        overlayContainer = oc;
        overlayContainerElement = oc.getContainerElement();
        viewport = v;
      })();
  });

  afterEach(() => {
    overlayContainer.ngOnDestroy();

    if (overlayRef) {
      overlayRef.dispose();
    }
  });

  function attachOverlay(config: OverlayConfig) {
    overlayRef = overlay.create(config);
    overlayRef.attach(new ComponentPortal(TestOverlay));
    zone.simulateZoneExit();
  }

  it('should throw when attempting to attach to multiple different overlays', () => {
    const origin = new ElementRef(document.createElement('div'));
    const positionStrategy = overlay.position()
        .flexibleConnectedTo(origin)
        .withPositions([{
          overlayX: 'start',
          overlayY: 'top',
          originX: 'start',
          originY: 'bottom'
        }]);

    attachOverlay({positionStrategy});
    expect(() => attachOverlay({positionStrategy})).toThrow();
  });

  it('should not throw when trying to apply after being disposed', () => {
    const origin = new ElementRef(document.createElement('div'));
    const positionStrategy = overlay.position()
        .flexibleConnectedTo(origin)
        .withPositions([{
          overlayX: 'start',
          overlayY: 'top',
          originX: 'start',
          originY: 'bottom'
        }]);

    attachOverlay({positionStrategy});
    overlayRef.dispose();

    expect(() => positionStrategy.apply()).not.toThrow();
  });

  it('should not throw when trying to re-apply the last position after being disposed', () => {
    const origin = new ElementRef(document.createElement('div'));
    const positionStrategy = overlay.position()
        .flexibleConnectedTo(origin)
        .withPositions([{
          overlayX: 'start',
          overlayY: 'top',
          originX: 'start',
          originY: 'bottom'
        }]);

    attachOverlay({positionStrategy});
    overlayRef.dispose();

    expect(() => positionStrategy.reapplyLastPosition()).not.toThrow();
  });

  describe('without flexible dimensions and pushing', () => {
    const ORIGIN_HEIGHT = DEFAULT_HEIGHT;
    const ORIGIN_WIDTH = DEFAULT_WIDTH;
    const OVERLAY_HEIGHT = DEFAULT_HEIGHT;
    const OVERLAY_WIDTH = DEFAULT_WIDTH;

    let originElement: HTMLElement;
    let positionStrategy: FlexibleConnectedPositionStrategy;

    beforeEach(() => {
      // The origin and overlay elements need to be in the document body in order to have geometry.
      originElement = createPositionedBlockElement();
      document.body.appendChild(originElement);
      positionStrategy = overlay.position()
          .flexibleConnectedTo(new ElementRef(originElement))
          .withFlexibleHeight(false)
          .withFlexibleWidth(false)
          .withPush(false);
    });

    afterEach(() => {
      document.body.removeChild(originElement);
    });

    describe('when not near viewport edge, not scrolled', () => {
      // Place the original element close to the center of the window.
      // (1024 / 2, 768 / 2). It's not exact, since outerWidth/Height includes browser
      // chrome, but it doesn't really matter for these tests.
      const ORIGIN_LEFT = 500;
      const ORIGIN_TOP = 350;

      beforeEach(() => {
        originElement.style.left = `${ORIGIN_LEFT}px`;
        originElement.style.top = `${ORIGIN_TOP}px`;
      });

      // Preconditions are set, now just run the full set of simple position tests.
      runSimplePositionTests();
    });

    describe('when scrolled', () => {
      // Place the original element decently far outside the unscrolled document (1024x768).
      const ORIGIN_LEFT = 2500;
      const ORIGIN_TOP = 2500;

      // Create a very large element that will make the page scrollable.
      let veryLargeElement: HTMLElement = document.createElement('div');
      veryLargeElement.style.width = '4000px';
      veryLargeElement.style.height = '4000px';

      beforeEach(() => {
        // Scroll the page such that the origin element is roughly in the
        // center of the visible viewport (2500 - 1024/2, 2500 - 768/2).
        document.body.appendChild(veryLargeElement);
        document.body.scrollTop = 2100;
        document.body.scrollLeft = 2100;

        originElement.style.top = `${ORIGIN_TOP}px`;
        originElement.style.left = `${ORIGIN_LEFT}px`;
      });

      afterEach(() => {
        document.body.removeChild(veryLargeElement);
        document.body.scrollTop = 0;
        document.body.scrollLeft = 0;
      });

      // Preconditions are set, now just run the full set of simple position tests.
      runSimplePositionTests();
    });

    describe('when near viewport edge', () => {
      it('should reposition the overlay if it would go off the top of the screen', () => {
        originElement.style.top = '5px';
        originElement.style.left = '200px';
        const originRect = originElement.getBoundingClientRect();

        positionStrategy.withPositions([
          {
            originX: 'end',
            originY: 'top',
            overlayX: 'end',
            overlayY: 'bottom'
          },
          {
            originX: 'start',
            originY: 'bottom',
            overlayX: 'start',
            overlayY: 'top'
          }
        ]);

        attachOverlay({positionStrategy});

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.top)).toBe(Math.floor(originRect.bottom));
        expect(Math.floor(overlayRect.left)).toBe(Math.floor(originRect.left));
      });

      it('should reposition the overlay if it would go off the left of the screen', () => {
        originElement.style.top = '200px';
        originElement.style.left = '5px';

        const originRect = originElement.getBoundingClientRect();
        const originCenterY = originRect.top + (ORIGIN_HEIGHT / 2);

        positionStrategy.withPositions([
          {
            originX: 'start',
            originY: 'bottom',
            overlayX: 'end',
            overlayY: 'top'
          },
          {
            originX: 'end',
            originY: 'center',
            overlayX: 'start',
            overlayY: 'center'
          }
        ]);

        attachOverlay({positionStrategy});

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.top)).toBe(Math.floor(originCenterY - (OVERLAY_HEIGHT / 2)));
        expect(Math.floor(overlayRect.left)).toBe(Math.floor(originRect.right));
      });

      it('should reposition the overlay if it would go off the bottom of the screen', () => {
        originElement.style.bottom = '25px';
        originElement.style.left = '200px';

        const originRect = originElement.getBoundingClientRect();

        positionStrategy.withPositions([
          {
            originX: 'start',
            originY: 'bottom',
            overlayX: 'start',
            overlayY: 'top'
          },
          {
            originX: 'end',
            originY: 'top',
            overlayX: 'end',
            overlayY: 'bottom'
          }
        ]);

        attachOverlay({positionStrategy});

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.bottom)).toBe(Math.floor(originRect.top));
        expect(Math.floor(overlayRect.right)).toBe(Math.floor(originRect.right));
      });

      it('should reposition the overlay if it would go off the right of the screen', () => {
        originElement.style.top = '200px';
        originElement.style.right = '25px';

        const originRect = originElement.getBoundingClientRect();

        positionStrategy.withPositions([
          {
            originX: 'end',
            originY: 'center',
            overlayX: 'start',
            overlayY: 'center'
          },
          {
            originX: 'start',
            originY: 'bottom',
            overlayX: 'end',
            overlayY: 'top'
          }
        ]);

        attachOverlay({positionStrategy});

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.top)).toBe(Math.floor(originRect.bottom));
        expect(Math.floor(overlayRect.right)).toBe(Math.floor(originRect.left));
      });

      it('should recalculate and set the last position with recalculateLastPosition()', () => {
        // Push the trigger down so the overlay doesn't have room to open on the bottom.
        originElement.style.bottom = '25px';

        const originRect = originElement.getBoundingClientRect();

        positionStrategy.withPositions([
          {
            originX: 'start',
            originY: 'bottom',
            overlayX: 'start',
            overlayY: 'top'
          },
          {
            originX: 'start',
            originY: 'top',
            overlayX: 'start',
            overlayY: 'bottom'
          }
        ]);

        // This should apply the fallback position, as the original position won't fit.
        attachOverlay({positionStrategy});

        // Now make the overlay small enough to fit in the first preferred position.
        overlayRef.overlayElement.style.height = '15px';

        // This should only re-align in the last position, even though the first would fit.
        positionStrategy.reapplyLastPosition();

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.bottom)).toBe(Math.floor(originRect.top),
            'Expected overlay to be re-aligned to the trigger in the previous position.');
      });

      it('should default to the initial position, if no positions fit in the viewport', () => {
        // Make the origin element taller than the viewport.
        originElement.style.height = '1000px';
        originElement.style.top = '0';

        const originRect = originElement.getBoundingClientRect();

        positionStrategy.withPositions([{
          originX: 'start',
          originY: 'top',
          overlayX: 'start',
          overlayY: 'bottom'
        }]);

        attachOverlay({positionStrategy});
        positionStrategy.reapplyLastPosition();

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.bottom)).toBe(Math.floor(originRect.top),
            'Expected overlay to be re-aligned to the trigger in the initial position.');
      });

      it('should position a panel properly when rtl', () => {
        // must make the overlay longer than the origin to properly test attachment
        overlayRef.overlayElement.style.width = `500px`;

        const originRect = originElement.getBoundingClientRect();

        positionStrategy.withPositions([{
          originX: 'start',
          originY: 'bottom',
          overlayX: 'start',
          overlayY: 'top'
        }]);

        attachOverlay({
          positionStrategy,
          direction: 'rtl'
        });

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.top)).toBe(Math.floor(originRect.bottom));
        expect(Math.floor(overlayRect.right)).toBe(Math.floor(originRect.right));
      });

      it('should position a panel with the x offset provided', () => {
        const originRect = originElement.getBoundingClientRect();

        positionStrategy.withPositions([{
          originX: 'start',
          originY: 'top',
          overlayX: 'start',
          overlayY: 'top',
          offsetX: 10
        }]);

        attachOverlay({positionStrategy});

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.top)).toBe(Math.floor(originRect.top));
        expect(Math.floor(overlayRect.left)).toBe(Math.floor(originRect.left + 10));
      });

      it('should position a panel with the y offset provided', () => {
        const originRect = originElement.getBoundingClientRect();

        positionStrategy.withPositions([{
          originX: 'start',
          originY: 'top',
          overlayX: 'start',
          overlayY: 'top',
          offsetY: 50
        }]);

        attachOverlay({positionStrategy});

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.top)).toBe(Math.floor(originRect.top + 50));
        expect(Math.floor(overlayRect.left)).toBe(Math.floor(originRect.left));
      });

      it('should allow for the fallback positions to specify their own offsets', () => {
        originElement.style.bottom = '0';
        originElement.style.left = '50%';
        originElement.style.position = 'fixed';

        const originRect = originElement.getBoundingClientRect();

        positionStrategy.withPositions([
          {
            originX: 'start',
            originY: 'top',
            overlayX: 'start',
            overlayY: 'top',
            offsetX: 50,
            offsetY: 50
          },
          {
            originX: 'start',
            originY: 'top',
            overlayX: 'start',
            overlayY: 'bottom',
            offsetX: -100,
            offsetY: -100
          }
        ]);

        attachOverlay({positionStrategy});

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.bottom)).toBe(Math.floor(originRect.top - 100));
        expect(Math.floor(overlayRect.left)).toBe(Math.floor(originRect.left - 100));
      });

    });

    it('should account for the `offsetX` pushing the overlay out of the screen', () => {
      // Position the element so it would have enough space to fit.
      originElement.style.top = '200px';
      originElement.style.left = '70px';

      const originRect = originElement.getBoundingClientRect();

      positionStrategy.withPositions([
        {
          originX: 'start',
          originY: 'top',
          overlayX: 'end',
          overlayY: 'top',
          offsetX: -20 // Add enough of an offset to pull the element out of the viewport.
        },
        {
          originX: 'end',
          originY: 'top',
          overlayX: 'start',
          overlayY: 'top'
        }
      ]);

      attachOverlay({positionStrategy});

      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
      expect(Math.floor(overlayRect.top)).toBe(Math.floor(originRect.top));
      expect(Math.floor(overlayRect.left)).toBe(Math.floor(originRect.right));
    });

    it('should account for the `offsetY` pushing the overlay out of the screen', () => {
      // Position the overlay so it would normally have enough space to fit.
      originElement.style.bottom = '40px';
      originElement.style.left = '200px';

      const originRect = originElement.getBoundingClientRect();

      positionStrategy.withPositions([
        {
          originX: 'start',
          originY: 'bottom',
          overlayX: 'start',
          overlayY: 'top',
          offsetY: 20 // Add enough of an offset for it to go off-screen.
        },
        {
          originX: 'end',
          originY: 'top',
          overlayX: 'end',
          overlayY: 'bottom'
        }
      ]);

      attachOverlay({positionStrategy});

      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
      expect(Math.floor(overlayRect.bottom)).toBe(Math.floor(originRect.top));
      expect(Math.floor(overlayRect.right)).toBe(Math.floor(originRect.right));
    });

    it('should emit onPositionChange event when the position changes', () => {
      originElement.style.top = '200px';
      originElement.style.right = '25px';

      positionStrategy.withPositions([
        {
          originX: 'end',
          originY: 'center',
          overlayX: 'start',
          overlayY: 'center'
        },
        {
          originX: 'start',
          originY: 'bottom',
          overlayX: 'end',
          overlayY: 'top'
        }
      ]);

      const positionChangeHandler = jasmine.createSpy('positionChangeHandler');
      const subscription = positionStrategy.positionChanges.subscribe(positionChangeHandler);

      attachOverlay({positionStrategy});

      const latestCall = positionChangeHandler.calls.mostRecent();

      expect(positionChangeHandler).toHaveBeenCalled();
      expect(latestCall.args[0] instanceof ConnectedOverlayPositionChange)
          .toBe(true, `Expected strategy to emit an instance of ConnectedOverlayPositionChange.`);

      // If the strategy is re-applied and the initial position would now fit,
      // the position change event should be emitted again.
      originElement.style.top = '200px';
      originElement.style.left = '200px';

      overlayRef.updatePosition();

      expect(positionChangeHandler).toHaveBeenCalledTimes(2);

      subscription.unsubscribe();
    });

    it('should emit the onPositionChange event even if none of the positions fit', () => {
      originElement.style.bottom = '25px';
      originElement.style.right = '25px';

      positionStrategy.withPositions([
        {
          originX: 'end',
          originY: 'bottom',
          overlayX: 'start',
          overlayY: 'top'
        },
        {
          originX: 'start',
          originY: 'bottom',
          overlayX: 'end',
          overlayY: 'top'
        }
      ]);

      const positionChangeHandler = jasmine.createSpy('positionChangeHandler');
      const subscription = positionStrategy.positionChanges.subscribe(positionChangeHandler);

      attachOverlay({positionStrategy});

      expect(positionChangeHandler).toHaveBeenCalled();

      subscription.unsubscribe();
    });

    it('should pick the fallback position that shows the largest area of the element', () => {
      originElement.style.top = '200px';
      originElement.style.right = '25px';

      const originRect = originElement.getBoundingClientRect();

      positionStrategy.withPositions([
        {
          originX: 'end',
          originY: 'center',
          overlayX: 'start',
          overlayY: 'center'
        },
        {
          originX: 'end',
          originY: 'top',
          overlayX: 'start',
          overlayY: 'bottom'
        },
        {
          originX: 'end',
          originY: 'top',
          overlayX: 'end',
          overlayY: 'top'
        }
      ]);

      attachOverlay({positionStrategy});

      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
      expect(Math.floor(overlayRect.top)).toBe(Math.floor(originRect.top));
      expect(Math.floor(overlayRect.left)).toBe(Math.floor(originRect.left));
    });

    it('should re-use the preferred position when re-applying while locked in', () => {
      positionStrategy.withPositions([
        {
          originX: 'end',
          originY: 'center',
          overlayX: 'start',
          overlayY: 'center'
        },
        {
          originX: 'start',
          originY: 'bottom',
          overlayX: 'end',
          overlayY: 'top'
        }
      ])
      .withLockedPosition();

      const recalcSpy = spyOn(positionStrategy, 'reapplyLastPosition');

      attachOverlay({positionStrategy});

      expect(recalcSpy).not.toHaveBeenCalled();

      positionStrategy.apply();

      expect(recalcSpy).toHaveBeenCalled();
    });

    /**
     * Run all tests for connecting the overlay to the origin such that first preferred
     * position does not go off-screen. We do this because there are several cases where we
     * want to run the exact same tests with different preconditions (e.g., not scroll, scrolled,
     * different element sized, etc.).
     */
    function runSimplePositionTests() {
      it('should position a panel below, left-aligned', () => {
        const originRect = originElement.getBoundingClientRect();

        positionStrategy.withPositions([{
          originX: 'start',
          originY: 'bottom',
          overlayX: 'start',
          overlayY: 'top'
        }]);

        attachOverlay({positionStrategy});

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.top)).toBe(Math.floor(originRect.bottom));
        expect(Math.floor(overlayRect.left)).toBe(Math.floor(originRect.left));
      });

      it('should position to the right, center aligned vertically', () => {
        const originRect = originElement.getBoundingClientRect();
        const originCenterY = originRect.top + (ORIGIN_HEIGHT / 2);

        positionStrategy.withPositions([{
          originX: 'end',
          originY: 'center',
          overlayX: 'start',
          overlayY: 'center'
        }]);

        attachOverlay({positionStrategy});

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.top)).toBe(Math.floor(originCenterY - (OVERLAY_HEIGHT / 2)));
        expect(Math.floor(overlayRect.left)).toBe(Math.floor(originRect.right));
      });

      it('should position to the left, below', () => {
        const originRect = originElement.getBoundingClientRect();

        positionStrategy.withPositions([{
          originX: 'start',
          originY: 'bottom',
          overlayX: 'end',
          overlayY: 'top'
        }]);

        attachOverlay({positionStrategy});

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.top)).toBe(Math.floor(originRect.bottom));
        expect(Math.round(overlayRect.right)).toBe(Math.round(originRect.left));
      });

      it('should position above, right aligned', () => {
        const originRect = originElement.getBoundingClientRect();

        positionStrategy.withPositions([{
          originX: 'end',
          originY: 'top',
          overlayX: 'end',
          overlayY: 'bottom'
        }]);

        attachOverlay({positionStrategy});

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.round(overlayRect.bottom)).toBe(Math.round(originRect.top));
        expect(Math.round(overlayRect.right)).toBe(Math.round(originRect.right));
      });

      it('should position below, centered', () => {
        const originRect = originElement.getBoundingClientRect();
        const originCenterX = originRect.left + (ORIGIN_WIDTH / 2);

        positionStrategy.withPositions([{
          originX: 'center',
          originY: 'bottom',
          overlayX: 'center',
          overlayY: 'top'
        }]);

        attachOverlay({positionStrategy});

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.top)).toBe(Math.floor(originRect.bottom));
        expect(Math.floor(overlayRect.left)).toBe(Math.floor(originCenterX - (OVERLAY_WIDTH / 2)));
      });

      it('should center the overlay on the origin', () => {
        const originRect = originElement.getBoundingClientRect();

        positionStrategy.withPositions([{
          originX: 'center',
          originY: 'center',
          overlayX: 'center',
          overlayY: 'center'
        }]);

        attachOverlay({positionStrategy});

        const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(Math.floor(overlayRect.top)).toBe(Math.floor(originRect.top));
        expect(Math.floor(overlayRect.left)).toBe(Math.floor(originRect.left));
      });
    }
  });

  describe('with pushing', () => {
    const OVERLAY_HEIGHT = DEFAULT_HEIGHT;
    const OVERLAY_WIDTH = DEFAULT_WIDTH;

    let originElement: HTMLElement;
    let positionStrategy: FlexibleConnectedPositionStrategy;

    beforeEach(() => {
      originElement = createPositionedBlockElement();
      document.body.appendChild(originElement);
      positionStrategy = overlay.position()
          .flexibleConnectedTo(new ElementRef(originElement))
          .withFlexibleHeight(false)
          .withFlexibleWidth(false)
          .withPush();
    });

    afterEach(() => {
      document.body.removeChild(originElement);
    });

    it('should be able to push an overlay into the viewport when it goes out on the right', () => {
      originElement.style.top = '200px';
      originElement.style.right = `${-OVERLAY_WIDTH / 2}px`;

      positionStrategy.withPositions([{
        originX: 'start',
        originY: 'bottom',
        overlayX: 'start',
        overlayY: 'top'
      }]);

      attachOverlay({positionStrategy});

      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
      expect(Math.floor(overlayRect.right)).toBe(viewport.getViewportSize().width);
    });

    it('should be able to push an overlay into the viewport when it goes out on the left', () => {
      originElement.style.top = '200px';
      originElement.style.left = `${-OVERLAY_WIDTH / 2}px`;

      positionStrategy.withPositions([{
        originX: 'start',
        originY: 'bottom',
        overlayX: 'start',
        overlayY: 'top'
      }]);

      attachOverlay({positionStrategy});

      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
      expect(Math.floor(overlayRect.left)).toBe(0);
    });

    it('should be able to push an overlay into the viewport when it goes out on the top', () => {
      originElement.style.top = `${-OVERLAY_HEIGHT * 2}px`;
      originElement.style.left = '200px';

      positionStrategy.withPositions([{
        originX: 'start',
        originY: 'bottom',
        overlayX: 'start',
        overlayY: 'top'
      }]);

      attachOverlay({positionStrategy});

      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
      expect(Math.floor(overlayRect.top)).toBe(0);
    });

    it('should be able to push an overlay into the viewport when it goes out on the bottom', () => {
      originElement.style.bottom = `${-OVERLAY_HEIGHT / 2}px`;
      originElement.style.left = '200px';

      positionStrategy.withPositions([{
        originX: 'start',
        originY: 'bottom',
        overlayX: 'start',
        overlayY: 'top'
      }]);

      attachOverlay({positionStrategy});

      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
      expect(Math.floor(overlayRect.bottom)).toBe(viewport.getViewportSize().height);
    });

    it('should set a margin when pushing the overlay into the viewport horizontally', () => {
      originElement.style.top = '200px';
      originElement.style.left = `${-OVERLAY_WIDTH / 2}px`;

      positionStrategy
        .withViewportMargin(15)
        .withPositions([{
          originX: 'start',
          originY: 'bottom',
          overlayX: 'start',
          overlayY: 'top'
        }]);

      attachOverlay({positionStrategy});

      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
      expect(Math.floor(overlayRect.left)).toBe(15);
    });

    it('should set a margin when pushing the overlay into the viewport vertically', () => {
      positionStrategy.withViewportMargin(15);

      originElement.style.top = `${-OVERLAY_HEIGHT * 2}px`;
      originElement.style.left = '200px';

      positionStrategy
        .withViewportMargin(15)
        .withPositions([{
          originX: 'start',
          originY: 'bottom',
          overlayX: 'start',
          overlayY: 'top'
        }]);

      attachOverlay({positionStrategy});

      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
      expect(Math.floor(overlayRect.top)).toBe(15);
    });

  });

  describe('with flexible dimensions', () => {
    const ORIGIN_WIDTH = DEFAULT_WIDTH;
    const ORIGIN_HEIGHT = DEFAULT_HEIGHT;
    const OVERLAY_HEIGHT = DEFAULT_HEIGHT;
    const OVERLAY_WIDTH = DEFAULT_WIDTH;

    let originElement: HTMLElement;
    let positionStrategy: FlexibleConnectedPositionStrategy;

    beforeEach(() => {
      originElement = createPositionedBlockElement();
      document.body.appendChild(originElement);
      positionStrategy = overlay.position().flexibleConnectedTo(new ElementRef(originElement));
    });

    afterEach(() => {
      document.body.removeChild(originElement);
    });

    it('should align the overlay to `flex-start` when the content is flowing to the right', () => {
      positionStrategy
        .withFlexibleWidth()
        .withFlexibleHeight()
        .withPositions([{
          overlayY: 'top',
          overlayX: 'start',
          originY: 'bottom',
          originX: 'start'
        }]);

      attachOverlay({positionStrategy});

      expect(overlayRef.overlayElement.style.justifyContent).toBe('flex-start');
    });

    it('should align the overlay to `flex-end` when the content is flowing to the left', () => {
      positionStrategy
        .withFlexibleWidth()
        .withFlexibleHeight()
        .withPositions([{
          overlayY: 'top',
          overlayX: 'end',
          originY: 'bottom',
          originX: 'end'
        }]);

      attachOverlay({positionStrategy});

      expect(overlayRef.overlayElement.style.justifyContent).toBe('flex-end');
    });

    it('should align the overlay to `center` when the content is centered', () => {
      positionStrategy
        .withFlexibleWidth()
        .withFlexibleHeight()
        .withPositions([{
          overlayY: 'top',
          overlayX: 'center',
          originY: 'bottom',
          originX: 'center'
        }]);

      attachOverlay({positionStrategy});

      expect(overlayRef.overlayElement.style.justifyContent).toBe('center');
    });

    it('should support offsets when centering', () => {
      originElement.style.top = '200px';
      originElement.style.left = '200px';

      positionStrategy
        .withFlexibleWidth()
        .withFlexibleHeight()
        .withPositions([{
          overlayY: 'center',
          overlayX: 'center',
          originY: 'center',
          originX: 'center',
          offsetY: 20,
          offsetX: -15
        }]);

      attachOverlay({positionStrategy});

      const originRect = originElement.getBoundingClientRect();
      const originCenterY = originRect.top + (ORIGIN_HEIGHT / 2);
      const originCenterX = originRect.left + (ORIGIN_WIDTH / 2);

      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
      const overlayCenterY = overlayRect.top + (OVERLAY_HEIGHT / 2);
      const overlayCenterX = overlayRect.left + (OVERLAY_WIDTH / 2);

      expect(overlayRef.overlayElement.style.transform).toBe('translateX(-15px) translateY(20px)');
      expect(Math.floor(overlayCenterY)).toBe(Math.floor(originCenterY) + 20);
      expect(Math.floor(overlayCenterX)).toBe(Math.floor(originCenterX) - 15);
    });

    it('should become scrollable when it hits the viewport edge with a flexible height', () => {
      originElement.style.left = '200px';
      originElement.style.bottom = `${OVERLAY_HEIGHT - 10}px`;

      positionStrategy
        .withFlexibleHeight()
        .withPositions([{
          overlayY: 'top',
          overlayX: 'start',
          originY: 'bottom',
          originX: 'start'
        }]);

      attachOverlay({positionStrategy});

      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
      expect(Math.floor(overlayRect.height)).toBe(OVERLAY_HEIGHT - 10);
      expect(Math.floor(overlayRect.bottom)).toBe(viewport.getViewportSize().height);
    });

    it('should become scrollable when it hits the viewport edge with a flexible width', () => {
      originElement.style.top = '200px';
      originElement.style.right = '-20px';

      positionStrategy
        .withFlexibleWidth()
        .withPositions([{
          overlayY: 'top',
          overlayX: 'start',
          originY: 'bottom',
          originX: 'start'
        }]);

      attachOverlay({positionStrategy});

      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
      expect(Math.floor(overlayRect.width)).toBe(OVERLAY_WIDTH - 20);
      expect(Math.floor(overlayRect.right)).toBe(viewport.getViewportSize().width);
    });

    it('should not collapse the height if the size is less than the minHeight', () => {
      originElement.style.left = '200px';
      originElement.style.bottom = `${OVERLAY_HEIGHT - 10}px`;

      positionStrategy
        .withFlexibleHeight()
        .withPositions([{
          overlayY: 'top',
          overlayX: 'start',
          originY: 'bottom',
          originX: 'start'
        }]);

      attachOverlay({
        positionStrategy,
        minHeight: OVERLAY_HEIGHT - 5
      });

      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
      expect(Math.floor(overlayRect.height)).toBe(OVERLAY_HEIGHT);
    });

    it('should not collapse the width if the size is less than the minWidth', () => {
      originElement.style.top = '200px';
      originElement.style.right = '-20px';

      positionStrategy
        .withFlexibleWidth()
        .withPositions([{
          overlayY: 'top',
          overlayX: 'start',
          originY: 'bottom',
          originX: 'start'
        }]);

      attachOverlay({
        minWidth: OVERLAY_WIDTH - 10,
        positionStrategy
      });

      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();
      expect(Math.floor(overlayRect.width)).toBe(OVERLAY_WIDTH);
    });

    it('should take `weight` into account when determining which position to pick', () => {
      originElement.style.top = '200px';
      originElement.style.right = '25px';

      positionStrategy
        .withFlexibleWidth()
        .withPositions([
          {
            originX: 'end',
            originY: 'top',
            overlayX: 'start',
            overlayY: 'bottom',
            weight: 3
          },
          {
            originX: 'end',
            originY: 'center',
            overlayX: 'start',
            overlayY: 'center'
          }
        ]);

      attachOverlay({positionStrategy});

      const originRect = originElement.getBoundingClientRect();
      const overlayRect = overlayRef.overlayElement.getBoundingClientRect();

      expect(Math.floor(overlayRect.bottom)).toBe(Math.floor(originRect.top));
      expect(Math.floor(overlayRect.left)).toBe(Math.floor(originRect.right));
    });

    it('should be able to opt-in to having the overlay grow after it was opened', () => {
      originElement.style.left = '200px';
      originElement.style.bottom = `${OVERLAY_HEIGHT - 10}px`;

      positionStrategy
        .withFlexibleHeight()
        .withGrowAfterOpen()
        .withPositions([{
          overlayY: 'top',
          overlayX: 'start',
          originY: 'bottom',
          originX: 'start'
        }]);

      attachOverlay({positionStrategy});

      let overlayRect = overlayRef.overlayElement.getBoundingClientRect();

      // The overlay should be scrollable, because it hit the viewport edge.
      expect(Math.floor(overlayRect.height)).toBe(OVERLAY_HEIGHT - 10);

      originElement.style.bottom = '200px';
      overlayRef.updatePosition();
      overlayRect = overlayRef.overlayElement.getBoundingClientRect();

      // The overlay should be back to full height.
      expect(Math.floor(overlayRect.height)).toBe(OVERLAY_HEIGHT);
    });

  });

  describe('onPositionChange with scrollable view properties', () => {
    let scrollable: HTMLDivElement;
    let positionChangeHandler: jasmine.Spy;
    let onPositionChangeSubscription: Subscription;

    beforeEach(() => {
      // Set up the origin
      const originElement = createBlockElement();
      originElement.style.margin = '0 1000px 1000px 0';  // Added so that the container scrolls

      // Create a scrollable container and put the origin inside
      scrollable = createOverflowContainerElement();
      document.body.appendChild(scrollable);
      scrollable.appendChild(originElement);

      // Create a strategy with knowledge of the scrollable container
      const strategy = overlay.position()
        .flexibleConnectedTo(new ElementRef(originElement))
        .withPositions([{
          originX: 'start',
          originY: 'bottom',
          overlayX: 'start',
          overlayY: 'top'
        }]);

      strategy.withScrollableContainers([
        new CdkScrollable(new ElementRef(scrollable), null!, null!)
      ]);

      positionChangeHandler = jasmine.createSpy('positionChange handler');
      onPositionChangeSubscription = strategy.positionChanges
        .pipe(map(event => event.scrollableViewProperties))
        .subscribe(positionChangeHandler);

      attachOverlay({positionStrategy: strategy});
    });

    afterEach(() => {
      onPositionChangeSubscription.unsubscribe();
      document.body.removeChild(scrollable);
    });

    it('should not have origin or overlay clipped or out of view without scroll', () => {
      expect(positionChangeHandler).toHaveBeenCalledWith(jasmine.objectContaining({
        isOriginClipped: false,
        isOriginOutsideView: false,
        isOverlayClipped: false,
        isOverlayOutsideView: false
      }));
    });

    it('should evaluate if origin is clipped if scrolled slightly down', () => {
      scrollable.scrollTop = 10;  // Clip the origin by 10 pixels
      overlayRef.updatePosition();

      expect(positionChangeHandler).toHaveBeenCalledWith(jasmine.objectContaining({
        isOriginClipped: true,
        isOriginOutsideView: false,
        isOverlayClipped: false,
        isOverlayOutsideView: false
      }));
    });

    it('should evaluate if origin is out of view and overlay is clipped if scrolled enough', () => {
      scrollable.scrollTop = 31;  // Origin is 30 pixels, move out of view and clip the overlay 1px
      overlayRef.updatePosition();

      expect(positionChangeHandler).toHaveBeenCalledWith(jasmine.objectContaining({
        isOriginClipped: true,
        isOriginOutsideView: true,
        isOverlayClipped: true,
        isOverlayOutsideView: false
      }));
    });

    it('should evaluate the overlay and origin are both out of the view', () => {
      scrollable.scrollTop = 61;  // Scroll by overlay height + origin height + 1px
      overlayRef.updatePosition();

      expect(positionChangeHandler).toHaveBeenCalledWith(jasmine.objectContaining({
        isOriginClipped: true,
        isOriginOutsideView: true,
        isOverlayClipped: true,
        isOverlayOutsideView: true
      }));
    });
  });

  describe('positioning properties', () => {
    let originElement: HTMLElement;
    let positionStrategy: FlexibleConnectedPositionStrategy;

    beforeEach(() => {
      originElement = createPositionedBlockElement();
      document.body.appendChild(originElement);
      positionStrategy = overlay.position().flexibleConnectedTo(new ElementRef(originElement));
    });

    afterEach(() => {
      document.body.removeChild(originElement);
    });

    describe('in ltr', () => {
      it('should use `left` when positioning an element at the start', () => {
        positionStrategy.withPositions([{
          originX: 'start',
          originY: 'top',
          overlayX: 'start',
          overlayY: 'top'
        }]);

        attachOverlay({positionStrategy});

        expect(overlayRef.overlayElement.style.left).toBeTruthy();
        expect(overlayRef.overlayElement.style.right).toBeFalsy();
      });

      it('should use `right` when positioning an element at the end', () => {
        positionStrategy.withPositions([{
          originX: 'end',
          originY: 'top',
          overlayX: 'end',
          overlayY: 'top'
        }]);

        attachOverlay({positionStrategy});

        expect(overlayRef.overlayElement.style.right).toBeTruthy();
        expect(overlayRef.overlayElement.style.left).toBeFalsy();
      });

    });

    describe('in rtl', () => {
      it('should use `right` when positioning an element at the start', () => {
        positionStrategy.withPositions([{
          originX: 'start',
          originY: 'top',
          overlayX: 'start',
          overlayY: 'top'
        }]);

        attachOverlay({
          positionStrategy,
          direction: 'rtl'
        });

        expect(overlayRef.overlayElement.style.right).toBeTruthy();
        expect(overlayRef.overlayElement.style.left).toBeFalsy();
      });

      it('should use `left` when positioning an element at the end', () => {
        positionStrategy.withPositions([{
          originX: 'end',
          originY: 'top',
          overlayX: 'end',
          overlayY: 'top'
        }]);

        attachOverlay({positionStrategy, direction: 'rtl'});

        expect(overlayRef.overlayElement.style.left).toBeTruthy();
        expect(overlayRef.overlayElement.style.right).toBeFalsy();
      });
    });

    describe('vertical', () => {
      it('should use `top` when positioning at element along the top', () => {
        positionStrategy.withPositions([{
          originX: 'start',
          originY: 'top',
          overlayX: 'start',
          overlayY: 'top'
        }]);

        attachOverlay({positionStrategy});

        expect(overlayRef.overlayElement.style.top).toBeTruthy();
        expect(overlayRef.overlayElement.style.bottom).toBeFalsy();
      });

      it('should use `bottom` when positioning at element along the bottom', () => {
        positionStrategy.withPositions([{
          originX: 'start',
          originY: 'bottom',
          overlayX: 'start',
          overlayY: 'bottom'
        }]);

        attachOverlay({positionStrategy});

        expect(overlayRef.overlayElement.style.bottom).toBeTruthy();
        expect(overlayRef.overlayElement.style.top).toBeFalsy();
      });
    });

  });

});

/** Creates an absolutely positioned, display: block element with a default size. */
function createPositionedBlockElement() {
  const element = createBlockElement();
  element.style.position = 'absolute';
  return element;
}

/** Creates a block element with a default size. */
function createBlockElement() {
  const element = document.createElement('div');
  element.style.width = `${DEFAULT_WIDTH}px`;
  element.style.height = `${DEFAULT_HEIGHT}px`;
  element.style.backgroundColor = 'rebeccapurple';
  element.style.zIndex = '100';
  return element;
}

/** Creates an overflow container with a set height and width with margin. */
function createOverflowContainerElement() {
  const element = document.createElement('div');
  element.style.position = 'relative';
  element.style.overflow = 'auto';
  element.style.height = '300px';
  element.style.width = '300px';
  element.style.margin = '100px';
  return element;
}


@Component({
  template: `<div style="width: ${DEFAULT_WIDTH}px; height: ${DEFAULT_HEIGHT}px;"></div>`
})
class TestOverlay { }


@NgModule({
  imports: [OverlayModule, PortalModule],
  exports: [TestOverlay],
  declarations: [TestOverlay],
  entryComponents: [TestOverlay],
})
class OverlayTestModule { }
