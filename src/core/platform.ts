/** Platform binding contract: everything the runtime needs from a host. */
import type { ImageFactory } from './image';
import type { WxCanvas, WxLike } from '../platforms/wx-types';
import type { Capabilities, ContextType, Disposer, Rect, TouchLikeEvent } from '../types';

export interface PlatformBinding {
  readonly kind: Capabilities['platform'];
  /** Undefined on the browser platform. */
  readonly wx?: WxLike;
  /** The raw platform canvas. The runtime patches it in place. */
  readonly rawCanvas: WxCanvas;
  readonly capabilities: Capabilities;
  readonly imageFactory: ImageFactory;
  /** Current bounding rect of `rawCanvas`; may be async on mini programs. */
  getCanvasRect(): Rect | Promise<Rect>;
  /** Create a secondary canvas without disturbing the on-screen one. */
  createOffscreenCanvas(width: number, height: number, type: ContextType): WxCanvas;
  /** Subscribe to platform touch events (no-op on mini programs). */
  watchTouch(handler: (event: TouchLikeEvent) => void): Disposer;
  watchVisibility(handler: (visible: boolean) => void): Disposer;
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(id: number): void;
  now(): number;
  /** Platform-specific teardown (detach listeners, release the canvas...). */
  dispose(): void;
}

export type PlatformFactory = () => PlatformBinding | Promise<PlatformBinding>;
