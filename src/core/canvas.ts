/** Canvas patching + offscreen canvas factory. */
import type { WxCanvas, WxLike } from '../platforms/wx-types';
import type { ContextType, Rect } from '../types';
import {
  HTMLCanvasElementShim,
  HTMLElementShim,
  OffscreenCanvasShim,
  WebGL2RenderingContextShim,
  WebGLRenderingContextShim,
  normalizeRect,
  patchElement,
  type PatchedElement,
} from './element';
import type { Diagnostics } from './diagnostics';

export interface PatchCanvasOptions {
  rect?: Partial<Rect>;
  document?: unknown;
  diagnostics?: Diagnostics;
  /** Cache contexts by type so identity is stable across repeated getContext(). */
  cacheContexts?: boolean;
  /** Apply defensive fixes to getExtension / drawingBuffer dimensions. */
  normalizeWebGL?: boolean;
  /**
   * `true` when `raw` is a real DOM canvas that already owns its event system
   * and DOM members (browser). Only missing members are filled in, and the
   * event target is left untouched. See ADR-0010.
   */
  nativeEventTarget?: boolean;
}

function findOriginalGetContext(raw: WxCanvas): (type: string, attrs?: Record<string, unknown>) => unknown {
  let node: object | null = raw;
  while (node) {
    const descriptor = Object.getOwnPropertyDescriptor(node, 'getContext');
    if (descriptor) {
      const fn = descriptor.value ?? descriptor.get?.call(raw);
      if (typeof fn === 'function') return (fn as (...args: never[]) => unknown).bind(raw) as never;
    }
    node = Object.getPrototypeOf(node) as object | null;
  }
  return () => null;
}

function normalizeContext(
  ctx: unknown,
  raw: WxCanvas,
  type: string,
  normalizeWebGL: boolean,
): unknown {
  if (!ctx || (typeof ctx !== 'object' && typeof ctx !== 'function')) return ctx;
  const target = ctx as Record<string, unknown>;
  if (type === 'webgl2') WebGL2RenderingContextShim.__instances.add(target as object);
  else if (type === 'webgl') WebGLRenderingContextShim.__instances.add(target as object);

  try {
    Object.defineProperty(target, 'canvas', { value: raw, configurable: true, writable: true });
  } catch {
    /* some hosts make canvas non-configurable; the native value is already usable */
  }

  if (normalizeWebGL && (type === 'webgl' || type === 'webgl2')) {
    const original = target.getExtension;
    if (typeof original === 'function') {
      Object.defineProperty(target, 'getExtension', {
        value: function (this: unknown, name: string): unknown {
          const result = (original as (n: string) => unknown).call(this, name);
          // A few Android base libraries return a number/boolean instead of an
          // extension object. three.js only needs a truthy object, never a number.
          if (typeof result === 'number' || typeof result === 'boolean') return result ? {} : null;
          return result ?? null;
        },
        configurable: true,
        writable: true,
      });
    }
    if (typeof target.drawingBufferWidth !== 'number') {
      Object.defineProperty(target, 'drawingBufferWidth', { get: () => raw.width, configurable: true });
    }
    if (typeof target.drawingBufferHeight !== 'number') {
      Object.defineProperty(target, 'drawingBufferHeight', { get: () => raw.height, configurable: true });
    }
  }
  return ctx;
}

export interface PatchedCanvasResult extends PatchedElement<WxCanvas> {
  /** Typed as HTMLCanvasElement so `new THREE.WebGLRenderer({ canvas })` type-checks. */
  canvas: HTMLCanvasElement;
  /** All contexts created so far, keyed by requested type. */
  contexts: Map<string, unknown>;
}

export function patchCanvas(raw: WxCanvas, options: PatchCanvasOptions = {}): PatchedCanvasResult {
  const originalGetContext = findOriginalGetContext(raw);
  const contexts = new Map<string, unknown>();
  const diagnostics = options.diagnostics;
  const cache = options.cacheContexts ?? true;

  const getContext = (type: string, attrs?: Record<string, unknown>): unknown => {
    const requested = type === 'experimental-webgl' ? 'webgl' : type;
    if (cache && contexts.has(requested)) return contexts.get(requested);
    let ctx: unknown;
    try {
      ctx = originalGetContext(requested, attrs);
    } catch (error) {
      diagnostics?.error(`canvas.getContext("${requested}") threw`, error);
      return null;
    }
    if (!ctx) {
      diagnostics?.warnOnce(
        `ctx-${String(requested)}`,
        `canvas.getContext("${String(requested)}") returned ${String(ctx)}. ` +
          `three.js >= r163 requires WebGL2; check game.json / device support.`,
      );
      return ctx;
    }
    ctx = normalizeContext(ctx, raw, requested, options.normalizeWebGL ?? false);
    if (cache) contexts.set(requested, ctx);
    return ctx;
  };

  const toDataURL = (type?: string, quality?: number): string => {
    if (typeof raw.toDataURL === 'function') return raw.toDataURL(type, quality);
    return 'data:,';
  };

  const native = options.nativeEventTarget === true;
  const extra: PropertyDescriptorMap = {
    // Context caching and WebGL normalisation stay ours even on a real canvas:
    // the native getContext is re-read through findOriginalGetContext, so
    // identity and behaviour are unchanged for the host.
    getContext: { value: getContext, writable: true },
  };
  if (!native) {
    extra.toDataURL = { value: toDataURL, writable: true };
    // three.js reads `canvas.nodeType` / `canvas.tagName` in a few addons.
    extra.nodeType = { value: 1 };
    extra.tagName = { value: 'CANVAS' };
    extra.nodeName = { value: 'CANVAS' };
  } else if (typeof (raw as Record<string, unknown>).toDataURL !== 'function') {
    // OffscreenCanvas has convertToBlob() instead; three still calls toDataURL
    // on 2D scratch canvases.
    extra.toDataURL = { value: toDataURL, writable: true };
  }

  const patched = patchElement(raw, {
    rect: normalizeRect(options.rect),
    document: options.document,
    instanceOf: [HTMLCanvasElementShim, HTMLElementShim],
    nativeEventTarget: native,
    extra,
  });

  return {
    ...patched,
    canvas: raw as unknown as HTMLCanvasElement,
    contexts,
  };
}

export interface CreateOffscreenCanvasOptions extends PatchCanvasOptions {
  type?: ContextType;
}

/** Create and patch an offscreen canvas without ever calling wx.createCanvas(). */
export function createOffscreenCanvas(
  wx: WxLike,
  width = 1,
  height = 1,
  options: CreateOffscreenCanvasOptions = {},
): HTMLCanvasElement {
  if (typeof wx.createOffscreenCanvas !== 'function') {
    throw new Error('[mini-three-adapter] wx.createOffscreenCanvas is unavailable on this base library');
  }
  const raw = wx.createOffscreenCanvas({
    width,
    height,
    type: options.type ?? '2d',
  });
  raw.width = width;
  raw.height = height;
  const patched = patchCanvas(raw, {
    ...options,
    rect: { width, height, left: 0, top: 0, right: width, bottom: height },
  });
  OffscreenCanvasShim.__instances.add(raw as object);
  return patched.canvas;
}
