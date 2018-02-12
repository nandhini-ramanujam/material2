/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {OverlayRefBase} from '../overlay-ref-base';

/** Strategy for setting the position on an overlay. */
export interface PositionStrategy {
  /** Attaches this position strategy to an overlay. */
  attach(overlayRef: OverlayRefBase): void;

  /** Updates the position of the overlay element. */
  apply(): void;

  /** Called when the overlay is detached. */
  detach?(): void;

  /** Cleans up any DOM modifications made by the position strategy, if necessary. */
  dispose(): void;
}
