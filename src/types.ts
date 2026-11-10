/**
 * Public type contracts for mini-three-adapter.
 *
 * Design note (AI context): everything in this file is **type-only**. The
 * runtime never imports from `three` and never assumes a browser global. This
 * keeps the adapter usable in Node (tests), in a WeChat mini game, in a WeChat
 * mini program webview-less runtime, and in a browser for H5 dual builds.
 */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface WindowInfo {
  /** CSS pixel width of the drawable area. */
  width: number;
  /** CSS pixel height of the drawable area. */
  height: number;
  /** Physical device pixel ratio, already capped by configuration. */
  pixelRatio: number;
  /** Raw device pixel ratio (before capping). */
  rawPixelRatio: number;
  /** Safe area in CSS pixels, when the platform exposes it. */
  safeArea?: Rect;
}

/** A single touch point, in either WeChat mini game or mini program shape. */
export interface TouchPoint {
  identifier?: number;
  clientX?: number;
  clientY?: number;
  pageX?: number;
  pageY?: number;
  x?: number;
  y?: number;
  force?: number;
}

/** Platform touch event shape. `touches`/`changedTouches` may be arrays or array-likes. */
export interface TouchLikeEvent {
  type: string;
  touches?: ArrayLike<TouchPoint>;
  changedTouches?: ArrayLike<TouchPoint>;
  timeStamp?: number;
  [key: string]: unknown;
}

export type TouchEventName =
  | 'touchstart'
  | 'touchmove'
  | 'touchend'
  | 'touchcancel'
  | 'tap';

/** Minimal W3C-ish pointer event consumed by three.js controls. */
export interface MiniPointerEvent {
  type: string;
  pointerId: number;
  pointerType: 'touch' | 'mouse' | 'pen';
  isPrimary: boolean;
  clientX: number;
  clientY: number;
  pageX: number;
  pageY: number;
  offsetX: number;
  offsetY: number;
  button: number;
  buttons: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  timeStamp: number;
  target: unknown;
  currentTarget: unknown;
  /** Non-standard, but three's OrbitControls reads it in some versions. */
  pointerX?: number;
  pointerY?: number;
  preventDefault(): void;
  stopPropagation(): void;
}

export type EventListenerLike = (event: unknown) => void;

export interface EventTargetLike {
  addEventListener(type: string, listener: EventListenerLike, options?: unknown): void;
  removeEventListener(type: string, listener: EventListenerLike, options?: unknown): void;
  dispatchEvent(event: unknown): boolean;
}

/** A wx canvas patched to look like an HTMLCanvasElement for three.js. */
export interface PatchedCanvas extends EventTargetLike {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  style: CanvasStyleLike;
  getContext(type: string, attrs?: Record<string, unknown>): unknown;
  getBoundingClientRect(): Rect;
  toDataURL(type?: string, quality?: number): string;
  setAttribute(name: string, value: unknown): void;
  removeAttribute(name: string): void;
  focus(): void;
  setPointerCapture(id: number): void;
  releasePointerCapture(id: number): void;
  requestPointerLock(): void;
  exitPointerLock(): void;
  ownerDocument: unknown;
  [key: string]: unknown;
}

export interface CanvasStyleLike {
  width: string;
  height: string;
  display: string;
  cursor?: string;
  touchAction?: string;
  [key: string]: unknown;
}

export type ContextType = 'webgl2' | 'webgl' | '2d';

export interface Capabilities {
  platform: 'wechat-game' | 'wechat-miniprogram' | 'browser' | 'unknown';
  /** `Canvas.getContext('webgl2')` is usable. three >= r163 requires WebGL2. */
  webgl2: boolean;
  /**
   * How `webgl2` was decided: `probe` = actually tried a context,
   * `inferred` = host could not be probed, value comes from the base library
   * version, `override` = supplied by the caller. A `false` from `inferred` is
   * a guess, not a measurement.
   */
  webgl2Source?: 'probe' | 'inferred' | 'override';
  webgl1: boolean;
  offscreenCanvas: boolean;
  worker: boolean;
  wasm: boolean;
  /** WXWebAssembly supports .wasm.br on some base libraries. */
  brotliWasm: boolean;
  /** wx.createImage / OffscreenCanvas.createImage availability. */
  nativeImage: boolean;
  /** wx.triggerGC is available (iOS high-performance mode hint). */
  triggerGC: boolean;
  /** wx.getWindowInfo available; otherwise we fall back to getSystemInfoSync. */
  getWindowInfo: boolean;
  /** wx.onWindowResize available. */
  windowResizeEvent: boolean;
  baseLibraryVersion: string;
}

export interface RuntimeEvents {
  resize: (info: WindowInfo) => void;
  visibilitychange: (visible: boolean) => void;
  contextlost: () => void;
  dispose: () => void;
  error: (error: Error) => void;
}

export type Disposer = () => void;

export interface FrameHandle {
  cancel(): void;
}

export interface FrameScheduler {
  request(callback: (time: number) => void): number;
  cancel(id: number): void;
  /** Convenience loop with a delta-time argument and automatic cleanup. */
  loop(callback: (deltaMs: number, time: number) => void): FrameHandle;
  /** Cap the logical frame rate; 0 disables the cap. */
  setFpsCap(fps: number): void;
  readonly fps: number;
  dispose(): void;
}
