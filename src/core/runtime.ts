/**
 * Runtime assembly.
 *
 * Everything here is platform-agnostic: a `PlatformBinding` supplies a raw
 * canvas, metrics, image factory and listeners; the runtime turns that into a
 * scoped, DOM-ish environment that three.js can consume, and gives back one
 * disposable object. There is exactly ONE public lifecycle entry point,
 * `createRuntime`, for every platform.
 */
import type { WxLike } from '../platforms/wx-types';
import type {
  CanvasStyleLike,
  Capabilities,
  ContextType,
  Disposer,
  FrameScheduler,
  Rect,
  RuntimeEvents,
  TouchLikeEvent,
  WindowInfo,
} from '../types';
import {
  createScope,
  getActiveScope,
  hasActiveScope,
  installGlobals,
  setActiveScope,
  type DocumentLike,
  type MiniThreeScope,
} from '../scope';
import { MiniBlob, MiniURL } from '../polyfills/blob-url';
import {
  MiniCustomEvent,
  MiniDOMException,
  MiniEvent,
  MiniEventTarget,
  MiniMessageEvent,
  MiniMouseEvent,
  MiniPointerEvent,
  MiniProgressEvent,
  patchEventTarget,
} from '../polyfills/event';
import {
  MiniAbortController,
  MiniAbortSignal,
  MiniXMLHttpRequest,
  createFetch,
  createXMLHttpRequestFactory,
} from '../polyfills/network';
import { MiniTextDecoder, MiniTextEncoder, atob, btoa } from '../polyfills/text-encoding';
import { capabilityReport, createDiagnostics, type Diagnostics, type LogLevel, type Reporter } from './diagnostics';
import { patchCanvas } from './canvas';
import { createDocument, createOffscreenCanvasCtor, createScreen, ShimDOMRect } from './dom';
import {
  DOMRectShim,
  HTMLCanvasElementShim,
  HTMLImageElementShim,
  HTMLElementShim,
  ImageDataShim,
  WebGL2RenderingContextShim,
  WebGLRenderingContextShim,
} from './element';
import { createFrameScheduler } from './frames';
import type { PlatformBinding, PlatformFactory } from './platform';
import { PointerBridge } from './pointer';
import { createWindowInfoStore, readWindowInfo, type WindowInfoStore } from './window-info';

export interface RuntimeOptions {
  /** Clamp devicePixelRatio (WeChat devices can report 3~4). Default 2. */
  pixelRatioCap?: number;
  /** Also replay pointer events on document / window. Default true. */
  propagatePointerEvents?: boolean;
  /** Emit legacy mouse* / click events. Default true. */
  emitMouseEvents?: boolean;
  /** Context type used by `document.createElement('canvas')`. Default 'webgl2'. */
  defaultContextType?: ContextType;
  /** Cache getContext() results so context identity is stable. Default true. */
  cacheContexts?: boolean;
  /** Fix known WeChat WebGL quirks (getExtension, drawingBuffer size). Default true. */
  normalizeWebGL?: boolean;
  /** Cap logical frames per second. 0 = uncapped. Default 0. */
  fpsCap?: number;
  logLevel?: LogLevel;
  reporter?: Reporter;
  /** Override detected capabilities (device tiers / tests). */
  capabilities?: Partial<Capabilities>;
  /** Immediately install scoped globals onto globalThis. Default false. */
  installGlobals?: boolean;
  /** Warn when a frame callback exceeds this many ms. 0 disables. Default 0. */
  slowFrameThreshold?: number;
}

export interface RendererHints {
  canvas: HTMLCanvasElement;
  antialias: boolean;
  alpha: boolean;
  powerPreference: 'high-performance';
  preserveDrawingBuffer: boolean;
  /** Recommended value; three.js r15x+ uses outputColorSpace, not outputEncoding. */
  outputColorSpace: 'srgb';
}

export interface MiniThreeRuntime {
  /** A wx canvas patched to behave as HTMLCanvasElement. */
  readonly canvas: HTMLCanvasElement;
  /** The scoped "window" object consumed by rewritten third-party modules. */
  readonly scope: MiniThreeScope;
  readonly document: DocumentLike;
  readonly capabilities: Capabilities;
  readonly diagnostics: Diagnostics;
  readonly frames: FrameScheduler;
  readonly bridge: PointerBridge;
  readonly windowInfo: WindowInfo;
  readonly rendererHints: RendererHints;
  readonly disposed: boolean;
  /** Feed a WeChat touch event. Mini games bind this automatically. */
  handleTouch(event: TouchLikeEvent, options?: { propagate?: boolean; computeRect?: boolean }): void;
  /** Re-measure the canvas and window, then emit `resize`. */
  resize(): Promise<void>;
  /** Opt-in global pollution for untransformed libraries; returns a disposer. */
  installGlobals(options?: { skipExisting?: boolean; extraKeys?: string[] }): Disposer;
  /** Create an additional patched canvas (e.g. for render targets / text). */
  createCanvas(width?: number, height?: number, type?: ContextType): HTMLCanvasElement;
  on<K extends keyof RuntimeEvents>(event: K, listener: RuntimeEvents[K]): Disposer;
  /** Dump a copy-pasteable capability report. */
  report(): string;
  dispose(): void;
}

function hostWxStub(): WxLike {
  const host = globalThis as unknown as {
    innerWidth?: number;
    innerHeight?: number;
    devicePixelRatio?: number;
  };
  return {
    getWindowInfo: () => ({
      windowWidth: host.innerWidth ?? 1,
      windowHeight: host.innerHeight ?? 1,
      pixelRatio: host.devicePixelRatio ?? 1,
    }),
  };
}

class NoopResizeObserver {
  observe(): void { /* no-op */ }
  unobserve(): void { /* no-op */ }
  disconnect(): void { /* no-op */ }
}

/** Create a runtime from a binding or an (async) platform factory. */
export async function createRuntime(
  platform: PlatformBinding | PlatformFactory,
  options: RuntimeOptions = {},
): Promise<MiniThreeRuntime> {
  const binding: PlatformBinding = typeof platform === 'function' ? await platform() : platform;
  const wx = binding.wx ?? hostWxStub();
  const diagnostics = createDiagnostics(options.logLevel ?? 'warn', options.reporter);
  const initialRect: Rect = await binding.getCanvasRect();

  const documentRef: { current: DocumentLike | null } = { current: null };
  const document = createDocument({
    binding,
    diagnostics,
    defaultContextType: options.defaultContextType ?? 'webgl2',
    documentRef,
  });

  const patched = patchCanvas(binding.rawCanvas, {
    rect: initialRect,
    document,
    diagnostics,
    cacheContexts: options.cacheContexts ?? true,
    normalizeWebGL: options.normalizeWebGL ?? true,
  });
  const canvas = patched.canvas;

  const windowInfo = createWindowInfoStore(wx, {
    pixelRatioCap: options.pixelRatioCap ?? 2,
    diagnostics,
  });

  const screen = createScreen(windowInfo.info.width, windowInfo.info.height);
  const scope = createScope();
  patchEventTarget(scope);
  document.defaultView = scope;
  scope.document = document;
  scope.screen = screen;
  scope.navigator = {
    userAgent: `Mozilla/5.0 (WeChat MiniGame) mini-three-adapter/${binding.capabilities.platform}`,
    platform: binding.capabilities.platform,
    hardwareConcurrency: 4,
  };

  // Live getters: three.js and controls read these on every resize.
  Object.defineProperties(scope, {
    innerWidth: { get: () => windowInfo.info.width, enumerable: true, configurable: true },
    innerHeight: { get: () => windowInfo.info.height, enumerable: true, configurable: true },
    outerWidth: { get: () => windowInfo.info.width, enumerable: true, configurable: true },
    outerHeight: { get: () => windowInfo.info.height, enumerable: true, configurable: true },
    devicePixelRatio: { get: () => windowInfo.info.pixelRatio, enumerable: true, configurable: true },
    pageXOffset: { get: () => 0, enumerable: true, configurable: true },
    pageYOffset: { get: () => 0, enumerable: true, configurable: true },
  });

  const frames = createFrameScheduler(
    (cb) => binding.requestAnimationFrame(cb),
    (id) => binding.cancelAnimationFrame(id),
    {
      now: () => binding.now(),
      ...(options.fpsCap ? { fpsCap: options.fpsCap } : {}),
      ...(options.slowFrameThreshold ? { slowFrameThreshold: options.slowFrameThreshold } : {}),
      onSlowFrame: (ms) => diagnostics.warnOnce('slow-frame', `Slow frame: ${ms.toFixed(1)}ms`),
    },
  );

  scope.performance = { now: () => binding.now() };
  scope.requestAnimationFrame = (cb) => frames.request(cb);
  scope.cancelAnimationFrame = (id) => frames.cancel(id);
  scope.getComputedStyle = (element: unknown) => {
    const style = (element as { style?: CanvasStyleLike } | null)?.style;
    return style ?? { width: '0px', height: '0px', display: 'block' };
  };
  scope.matchMedia = (query: string) => ({
    matches: false, media: query, addListener: () => undefined, removeListener: () => undefined,
  });
  scope.atob = atob;
  scope.btoa = btoa;

  // --- event constructors -------------------------------------------------
  scope.Event = MiniEvent;
  scope.EventTarget = MiniEventTarget;
  scope.CustomEvent = MiniCustomEvent;
  scope.PointerEvent = MiniPointerEvent;
  scope.MouseEvent = MiniMouseEvent;
  scope.TouchEvent = MiniEvent;
  scope.MessageEvent = MiniMessageEvent;
  scope.ProgressEvent = MiniProgressEvent;
  scope.KeyboardEvent = MiniEvent;
  scope.DOMException = MiniDOMException;

  // --- DOM constructors ---------------------------------------------------
  scope.HTMLElement = HTMLElementShim;
  scope.HTMLCanvasElement = HTMLCanvasElementShim;
  scope.HTMLImageElement = HTMLImageElementShim;
  scope.HTMLVideoElement = undefined;
  scope.OffscreenCanvas = createOffscreenCanvasCtor(binding);
  scope.Image = binding.imageFactory.Image;
  scope.ImageData = binding.imageFactory.ImageData;
  scope.DOMRect = ShimDOMRect;
  scope.WebGLRenderingContext = WebGLRenderingContextShim;
  scope.WebGL2RenderingContext = WebGL2RenderingContextShim;
  scope.AudioContext = typeof (wx as Record<string, unknown>).createWebAudioContext === 'function'
    ? (wx as Record<string, unknown>).createWebAudioContext
    : undefined;

  // --- networking / encoding ---------------------------------------------
  scope.Blob = MiniBlob;
  scope.URL = MiniURL;
  scope.FileReader = undefined;
  scope.TextDecoder = MiniTextDecoder;
  scope.TextEncoder = MiniTextEncoder;
  scope.AbortController = MiniAbortController;
  scope.AbortSignal = MiniAbortSignal;
  scope.fetch = createFetch(wx);
  scope.XMLHttpRequest = createXMLHttpRequestFactory(wx);
  scope.WebSocket = undefined;
  scope.createImageBitmap = undefined;
  scope.ResizeObserver = NoopResizeObserver;
  const host = globalThis as unknown as Record<string, unknown>;
  scope.Worker = host.Worker ?? undefined;
  scope.WebAssembly = host.WebAssembly ?? host.WXWebAssembly ?? undefined;

  // --- input ---------------------------------------------------------------
  const bridge = new PointerBridge({
    getRect: () => canvas.getBoundingClientRect() as Rect,
    targets: { element: canvas as unknown as { dispatchEvent(event: unknown): boolean }, document, window: scope },
    propagate: options.propagatePointerEvents ?? true,
    emitMouseEvents: options.emitMouseEvents ?? true,
    diagnostics,
  });

  // Let controls call setPointerCapture / releasePointerCapture meaningfully.
  Object.defineProperties(canvas, {
    setPointerCapture: { value: (id: number) => bridge.setPointerCapture(id, canvas as never), configurable: true },
    releasePointerCapture: { value: (id: number) => bridge.releasePointerCapture(id), configurable: true },
    hasPointerCapture: { value: (id: number) => bridge.activePointerCount > 0 && id >= 0, configurable: true },
  });

  const emitter = new Map<keyof RuntimeEvents, Set<(...args: never[]) => void>>();
  const emit = <K extends keyof RuntimeEvents>(name: K, ...args: Parameters<RuntimeEvents[K]>): void => {
    const set = emitter.get(name);
    if (!set) return;
    for (const listener of Array.from(set)) (listener as (...a: Parameters<RuntimeEvents[K]>) => void)(...args);
  };
  const on = <K extends keyof RuntimeEvents>(name: K, listener: RuntimeEvents[K]): Disposer => {
    let set = emitter.get(name);
    if (!set) { set = new Set(); emitter.set(name, set); }
    set.add(listener as (...args: never[]) => void);
    return () => set?.delete(listener as (...args: never[]) => void);
  };

  const disposers: Disposer[] = [];
  let disposed = false;

  disposers.push(windowInfo.onChange((info) => {
    screen.width = info.width;
    screen.height = info.height;
    screen.availWidth = info.width;
    screen.availHeight = info.height;
    emit('resize', info);
  }));

  disposers.push(binding.watchTouch((event) => {
    bridge.dispatch(event);
  }));
  disposers.push(binding.watchVisibility((visible) => {
    emit('visibilitychange', visible);
    document.visibilityState = visible ? 'visible' : 'hidden';
  }));

  // WebGL context loss: emit a typed runtime event so the app can rebuild.
  canvas.addEventListener('webglcontextlost', (event: unknown) => {
    (event as { preventDefault?: () => void })?.preventDefault?.();
    emit('contextlost');
  });

  const restoreScope = setActiveScope(scope);
  disposers.push(restoreScope);

  const runtime: MiniThreeRuntime = {
    canvas,
    scope,
    document,
    capabilities: binding.capabilities,
    diagnostics,
    frames,
    bridge,
    get windowInfo() { return windowInfo.info; },
    rendererHints: {
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      outputColorSpace: 'srgb',
    },
    get disposed() { return disposed; },
    handleTouch(event, opts) { bridge.dispatch(event, opts); },
    async resize() { await resize(); },
    installGlobals(opts) {
      const undo = installGlobals(scope, opts);
      disposers.push(undo);
      return undo;
    },
    createCanvas(width = 1, height = 1, type: ContextType = '2d') {
      const raw = binding.createOffscreenCanvas(width, height, type);
      const p = patchCanvas(raw, {
        rect: { width, height, left: 0, top: 0, right: width, bottom: height },
        document,
        diagnostics,
      });
      return p.canvas;
    },
    on,
    report: () => capabilityReport(binding.capabilities),
    dispose() {
      if (disposed) return;
      disposed = true;
      emit('dispose');
      for (const undo of disposers.splice(0).reverse()) {
        try { undo(); } catch (error) { diagnostics.warn('disposer threw', error); }
      }
      bridge.dispose();
      frames.dispose();
      windowInfo.dispose();
      binding.dispose();
      MiniURL.clearObjectURLs();
      const clearable = canvas as unknown as { clearEventListeners?: () => void };
      clearable.clearEventListeners?.();
      emitter.clear();
    },
  };

  async function resize(): Promise<void> {
    const next = await binding.getCanvasRect();
    patched.updateRect(next);
    bridge.setRect(next);
    windowInfo.refresh();
    diagnostics.debug('runtime resized', next);
  }

  if (options.installGlobals) runtime.installGlobals({ skipExisting: true });
  if (!binding.capabilities.webgl2) {
    diagnostics.warn('WebGL2 was not detected.\n' + capabilityReport(binding.capabilities));
  }
  diagnostics.info('runtime ready', { platform: binding.capabilities.platform, rect: initialRect });

  return runtime;
}

/** The active scoped global, if a runtime has been created. */
export function currentScope(): MiniThreeScope | null {
  return hasActiveScope() ? getActiveScope() : null;
}

export { readWindowInfo };
export type { WindowInfoStore, MiniXMLHttpRequest, Diagnostics };
