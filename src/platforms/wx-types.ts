/**
 * Hand-written, minimal structural types for the WeChat runtime.
 *
 * Why not `minigame-api-typings`? Because consuming the official typings forces
 * a global `wx` declaration onto every consumer (including browser builds and
 * Node tests) and couples us to a specific version. Structural interfaces let
 * the adapter work with a real `wx`, a mock in tests, or a future platform.
 */

export interface WxCanvas {
  width: number;
  height: number;
  getContext(type: string, attributes?: Record<string, unknown>): unknown;
  toDataURL?(type?: string, quality?: number): string;
  createImage?(): WxImage;
  requestAnimationFrame?(callback: (time: number) => void): number;
  cancelAnimationFrame?(id: number): void;
  [key: string]: unknown;
}

export interface WxImage {
  width: number;
  height: number;
  src: string;
  onload?: ((event?: unknown) => void) | null;
  onerror?: ((error?: unknown) => void) | null;
  complete?: boolean;
  [key: string]: unknown;
}

export interface WxRect {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface WxWindowInfo {
  windowWidth: number;
  windowHeight: number;
  pixelRatio: number;
  screenWidth?: number;
  screenHeight?: number;
  safeArea?: WxRect;
}

export interface WxTouchPoint {
  identifier?: number;
  clientX?: number;
  clientY?: number;
  pageX?: number;
  pageY?: number;
  x?: number;
  y?: number;
  force?: number;
}

export interface WxTouchEvent {
  type: string;
  touches?: ArrayLike<WxTouchPoint>;
  changedTouches?: ArrayLike<WxTouchPoint>;
  timeStamp?: number;
}

export interface WxRequestResult {
  statusCode: number;
  data: string | ArrayBuffer | Record<string, unknown>;
  header?: Record<string, string>;
  errMsg?: string;
}

export interface WxRequestOptions {
  url: string;
  method?: string;
  data?: unknown;
  header?: Record<string, string>;
  responseType?: 'text' | 'arraybuffer';
  timeout?: number;
  success?: (result: WxRequestResult) => void;
  fail?: (error: { errMsg?: string; [key: string]: unknown }) => void;
}

export interface WxSelectorQueryResult {
  node?: WxCanvas;
  width?: number;
  height?: number;
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
}

export interface WxSelectorQuery {
  select(selector: string): WxSelectorQuery;
  fields(fields: Record<string, boolean>): WxSelectorQuery;
  exec(callback: (results: (WxSelectorQueryResult | null)[]) => void): void;
}

/** The subset of `wx` the adapter touches. All members are optional so the
 *  same interface can describe a mini game, a mini program or a test mock. */
export interface WxLike {
  createCanvas?(): WxCanvas;
  createOffscreenCanvas?(options?: {
    width?: number;
    height?: number;
    type?: '2d' | 'webgl' | 'webgl2';
  }): WxCanvas;
  createImage?(): WxImage;
  createImageData?(width: number, height: number): unknown;
  getWindowInfo?(): WxWindowInfo;
  getSystemInfoSync?(): WxWindowInfo;
  onWindowResize?(listener: (res: { windowWidth: number; windowHeight: number }) => void): void;
  offWindowResize?(listener: (res: { windowWidth: number; windowHeight: number }) => void): void;

  onTouchStart?(listener: (event: WxTouchEvent) => void): void;
  onTouchMove?(listener: (event: WxTouchEvent) => void): void;
  onTouchEnd?(listener: (event: WxTouchEvent) => void): void;
  onTouchCancel?(listener: (event: WxTouchEvent) => void): void;
  offTouchStart?(listener: (event: WxTouchEvent) => void): void;
  offTouchMove?(listener: (event: WxTouchEvent) => void): void;
  offTouchEnd?(listener: (event: WxTouchEvent) => void): void;
  offTouchCancel?(listener: (event: WxTouchEvent) => void): void;

  onShow?(listener: () => void): void;
  onHide?(listener: () => void): void;
  offShow?(listener: () => void): void;
  offHide?(listener: () => void): void;

  request?(options: WxRequestOptions): { abort?(): void };
  createSelectorQuery?(): WxSelectorQuery;
  getPerformance?(): { now(): number };
  setPreferredFramesPerSecond?(fps: number): void;
  triggerGC?(): void;
  createWorker?(path: string, options?: unknown): unknown;
  env?: { USER_DATA_PATH?: string; [key: string]: unknown };
  getSystemInfo?(options: { success?: (info: WxWindowInfo & { SDKVersion?: string }) => void }): void;
  [key: string]: unknown;
}

/** Resolve `wx` from an explicit injection or from the host global. */
export function resolveWx(injected?: WxLike): WxLike {
  if (injected) return injected;
  const host = globalThis as unknown as Record<string, unknown>;
  const wx = host.wx as WxLike | undefined;
  if (!wx) {
    throw new Error(
      '[mini-three-adapter] `wx` is not available. Pass `{ wx }` in options when running outside WeChat (e.g. in Node tests).',
    );
  }
  return wx;
}
