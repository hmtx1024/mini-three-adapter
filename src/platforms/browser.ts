/**
 * Browser platform. Used for H5 dual-target builds (uni-app / weapp-vite H5)
 * and for running the adapter in Node-based unit tests with an injected canvas.
 *
 * The whole point of scoped globals is that the SAME application code can run
 * here without uninstalling a `window` shim first.
 */
import type { Capabilities, ContextType, Disposer, NativeEventInit, Rect, TouchLikeEvent } from '../types';
import type { PlatformBinding } from '../core/platform';
import { createRuntime, type MiniThreeRuntime, type RuntimeOptions } from '../core/runtime';
import { detectCapabilities } from '../core/capabilities';
import { createDiagnostics, type Diagnostics } from '../core/diagnostics';
import { createImageFactory } from '../core/image';
import { patchEventTarget } from '../polyfills/event';
import type { WxCanvas, WxLike, WxWindowInfo } from './wx-types';

type NativeEventCtor = new (type: string, init?: Record<string, unknown>) => object;

function hostEvents(): {
  PointerEvent?: NativeEventCtor;
  MouseEvent?: NativeEventCtor;
  WheelEvent?: NativeEventCtor;
  Event?: NativeEventCtor;
} {
  return globalThis as unknown as {
    PointerEvent?: NativeEventCtor;
    MouseEvent?: NativeEventCtor;
    WheelEvent?: NativeEventCtor;
    Event?: NativeEventCtor;
  };
}

/**
 * Specialised constructors only. Falling back to `Event` here would silently
 * drop `clientX` / `pointerId`, because `new Event(type, init)` ignores them;
 * the generic path below fills those fields explicitly instead.
 */
function ctorFor(type: string): NativeEventCtor | undefined {
  const host = hostEvents();
  if (type.startsWith('pointer')) return host.PointerEvent;
  if (type === 'wheel') return host.WheelEvent ?? host.MouseEvent;
  if (type.startsWith('mouse') || type === 'click') return host.MouseEvent;
  return undefined;
}

/**
 * Build a real DOM event. Falls back to `Event` plus own properties when the
 * host lacks the specialised constructor (old WebViews, Node tests): a plain
 * `Event` is what `dispatchEvent` accepts, and the extra fields keep readers
 * like OrbitControls working.
 */
function createNativeEvent(type: string, init: NativeEventInit): unknown {
  const Ctor = ctorFor(type);
  if (Ctor) {
    try {
      return new Ctor(type, init as Record<string, unknown>);
    } catch {
      /* constructor rejected a field; use the generic path below */
    }
  }
  const Base = hostEvents().Event;
  if (!Base) return { type, ...init };
  const base = new Base(type, { bubbles: init.bubbles, cancelable: init.cancelable });
  for (const [key, value] of Object.entries(init)) {
    if (key in base) continue;
    try {
      Object.defineProperty(base, key, { value, configurable: true, enumerable: true, writable: true });
    } catch {
      /* non-extensible host event */
    }
  }
  return base;
}

export interface BrowserPlatformOptions {
  canvas?: HTMLCanvasElement;
  capabilities?: Partial<Capabilities>;
  diagnostics?: Diagnostics;
}

function createMockCanvas(width = 1, height = 1): WxCanvas {
  const canvas: WxCanvas = {
    width,
    height,
    getContext: () => ({
      canvas: null,
      getExtension: () => null,
      getParameter: () => 0,
    }),
    toDataURL: () => 'data:,',
  };
  // No `document` (Node tests): this stand-in has no native event system, so
  // give it one before the runtime treats it as a native target.
  patchEventTarget(canvas);
  return canvas;
}

function browserWx(): WxLike {
  const host = globalThis as unknown as {
    window?: Window;
    document?: Document;
    innerWidth?: number;
    innerHeight?: number;
    devicePixelRatio?: number;
  };
  const resizeListeners = new Set<(info: { windowWidth: number; windowHeight: number }) => void>();
  const onResize = (): void => {
    for (const listener of resizeListeners) {
      listener({ windowWidth: host.innerWidth ?? 1, windowHeight: host.innerHeight ?? 1 });
    }
  };
  if (host.window && typeof host.window.addEventListener === 'function') {
    host.window.addEventListener('resize', onResize);
  }
  const info = (): WxWindowInfo => ({
    windowWidth: host.innerWidth ?? host.document?.documentElement?.clientWidth ?? 1,
    windowHeight: host.innerHeight ?? host.document?.documentElement?.clientHeight ?? 1,
    pixelRatio: host.devicePixelRatio ?? 1,
  });

  return {
    getWindowInfo: info,
    onWindowResize: (listener) => { resizeListeners.add(listener); },
    offWindowResize: (listener) => { resizeListeners.delete(listener); },
    createCanvas: () => (host.document
      ? (host.document.createElement('canvas') as unknown as WxCanvas)
      : createMockCanvas()),
    createOffscreenCanvas: ({ width = 1, height = 1 } = {}) => {
      if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height) as unknown as WxCanvas;
      }
      const c = host.document
        ? (host.document.createElement('canvas') as unknown as WxCanvas)
        : createMockCanvas(width, height);
      c.width = width;
      c.height = height;
      return c;
    },
    createImage: () => (host.document
      ? (host.document.createElement('img') as unknown as ReturnType<NonNullable<WxLike['createImage']>>)
      : ({} as ReturnType<NonNullable<WxLike['createImage']>>)),
    request: (options) => {
      const nativeFetch = (globalThis as unknown as Record<string, unknown>).fetch as
        | ((url: string, init?: unknown) => Promise<unknown>)
        | undefined;
      if (!nativeFetch) { options.fail?.({ errMsg: 'fetch unavailable' }); return {}; }
      void nativeFetch(String(options.url), { method: options.method, headers: options.header })
        .then(async (response) => {
          const res = response as { status: number; headers: Headers; arrayBuffer(): Promise<ArrayBuffer> };
          const data = options.responseType === 'arraybuffer' ? await res.arrayBuffer() : await (response as Response).text();
          const header: Record<string, string> = {};
          res.headers?.forEach?.((value: string, key: string) => { header[key] = value; });
          options.success?.({ statusCode: res.status, data, header });
        })
        .catch((error: unknown) => options.fail?.({ errMsg: String(error) }));
      return {};
    },
  } as WxLike;
}

export function createBrowserBinding(options: BrowserPlatformOptions = {}): PlatformBinding {
  const wx = browserWx();
  const diagnostics = options.diagnostics ?? createDiagnostics('warn');
  const host = globalThis as unknown as {
    document?: Document;
    requestAnimationFrame?: (cb: (time: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
    performance?: Performance;
  };
  const rawCanvas = (options.canvas ?? wx.createCanvas?.()) as WxCanvas;
  if (!rawCanvas) throw new Error('[mini-three-adapter] no canvas available in browser platform');

  const capabilities = detectCapabilities(wx, 'browser', {
    overrides: { webgl2: true, webgl1: true, worker: true, wasm: true, ...options.capabilities },
  });

  const getCanvasRect = (): Rect => {
    const rect = (rawCanvas as unknown as HTMLCanvasElement).getBoundingClientRect?.();
    if (rect && rect.width > 0) {
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    }
    return { top: 0, left: 0, width: rawCanvas.width, height: rawCanvas.height, right: rawCanvas.width, bottom: rawCanvas.height };
  };

  const watchTouch = (handler: (event: TouchLikeEvent) => void): Disposer => {
    // A real canvas owns a trusted pointer stream already. Synthesising a
    // second one from touch* would double-deliver every gesture, so only old
    // hosts without PointerEvent fall back to the bridge.
    if (typeof hostEvents().PointerEvent === 'function') return () => undefined;
    const element = rawCanvas as unknown as HTMLCanvasElement;
    if (typeof element.addEventListener !== 'function') return () => undefined;
    const names = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];
    const forward = (event: Event): void => handler(event as unknown as TouchLikeEvent);
    for (const name of names) element.addEventListener(name, forward, { passive: true });
    return () => {
      for (const name of names) element.removeEventListener(name, forward);
    };
  };

  const watchVisibility = (handler: (visible: boolean) => void): Disposer => {
    const doc = host.document;
    if (!doc) return () => undefined;
    const forward = (): void => handler(doc.visibilityState !== 'hidden');
    doc.addEventListener('visibilitychange', forward);
    return () => doc.removeEventListener('visibilitychange', forward);
  };

  return {
    kind: 'browser',
    wx,
    rawCanvas,
    capabilities,
    // A browser canvas already owns its event system: the runtime must not
    // replace it. See ADR-0010.
    nativeEventTarget: true,
    createEvent: createNativeEvent,
    imageFactory: createImageFactory(wx, diagnostics),
    getCanvasRect,
    createOffscreenCanvas: (width: number, height: number, _type: ContextType) => {
      const c = wx.createOffscreenCanvas?.({ width, height, type: '2d' }) ?? createMockCanvas(width, height);
      c.width = width;
      c.height = height;
      return c;
    },
    watchTouch,
    watchVisibility,
    requestAnimationFrame: (cb) => host.requestAnimationFrame
      ? host.requestAnimationFrame(cb)
      : (setTimeout(() => cb(Date.now()), 16) as unknown as number),
    cancelAnimationFrame: (id) => host.cancelAnimationFrame
      ? host.cancelAnimationFrame(id)
      : clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
    now: () => host.performance?.now?.() ?? Date.now(),
    dispose: () => diagnostics.debug('browser binding disposed'),
  };
}

export type BrowserRuntimeOptions = BrowserPlatformOptions & RuntimeOptions;

export function createBrowserRuntime(options: BrowserRuntimeOptions = {}): Promise<MiniThreeRuntime> {
  return createRuntime(() => createBrowserBinding(options), options);
}
