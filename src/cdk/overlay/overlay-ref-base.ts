/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Portal} from '@angular/cdk/portal';

/**
 * Basic interface for an overlay. Used to avoid circular type references between
 * `OverlayRef`, `PositionStrategy` and `ScrollStrategy`, and `OverlayConfig`.
 * @docs-private
 */
export interface OverlayRefBase {
  attach: (portal: Portal<any>) => any;
  detach: () => any;
  dispose: () => void;
  overlayElement: HTMLElement;
  getConfig: () => any;
  hasAttached: () => boolean;
  updateSize: (config: any) => void;
  updatePosition: () => void;
}
