/** Shared WeChat plumbing used by both mini game and mini program bindings. */
import type { ContextType, Disposer, Rect, TouchLikeEvent } from '../types';
import type { WxCanvas, WxLike, WxTouchEvent } from './wx-types';
import { createImageFactory, type ImageFactory } from '../core/image';
import type { Diagnostics } from '../core/diagnostics';

export function createWechatImageFactory(wx: WxLike, diagnostics?: Diagnostics): ImageFactory {
  return createImageFactory(wx, diagnostics);
}

/** rAF comes from the global in mini games, from the canvas node in mini programs. */
export function createRafPair(
  wx: WxLike,
  canvas?: WxCanvas,
): { request(cb: (time: number) => void): number; cancel(id: number): void } {
  const host = globalThis as unknown as {
    requestAnimationFrame?: (cb: (time: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  const canvasRaf = canvas?.requestAnimationFrame?.bind(canvas);
  const canvasCaf = canvas?.cancelAnimationFrame?.bind(canvas);
  const request = canvasRaf ?? host.requestAnimationFrame?.bind(host) ??
    ((cb: (time: number) => void) => setTimeout(() => cb(Date.now()), 16) as unknown as number);
  const cancel = canvasCaf ?? host.cancelAnimationFrame?.bind(host) ??
    ((id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>));
  void wx;
  return { request, cancel };
}

export function createNow(wx: WxLike): () => number {
  const perf = wx.getPerformance?.();
  if (perf && typeof perf.now === 'function') return () => perf.now();
  const host = globalThis as unknown as { performance?: { now(): number } };
  const hostPerf = host.performance;
  if (hostPerf && typeof hostPerf.now === 'function') return () => hostPerf.now();
  const start = Date.now();
  return () => Date.now() - start;
}

/** Subscribe to mini game touch events. Mini programs use WXML bindings instead. */
export function watchWxTouch(wx: WxLike, handler: (event: TouchLikeEvent) => void): Disposer {
  const methods = ['onTouchStart', 'onTouchMove', 'onTouchEnd', 'onTouchCancel'] as const;
  const offs = ['offTouchStart', 'offTouchMove', 'offTouchEnd', 'offTouchCancel'] as const;
  const attached: Array<[string, (event: WxTouchEvent) => void]> = [];
  methods.forEach((name, index) => {
    const attach = wx[name];
    if (typeof attach !== 'function') return;
    const listener = (event: WxTouchEvent): void => handler(event as TouchLikeEvent);
    attach.call(wx, listener);
    attached.push([offs[index] as string, listener]);
  });
  return () => {
    for (const [off, listener] of attached) {
      const fn = (wx as Record<string, unknown>)[off];
      if (typeof fn === 'function') (fn as (l: unknown) => void).call(wx, listener);
    }
  };
}

export function watchWxVisibility(wx: WxLike, handler: (visible: boolean) => void): Disposer {
  const onShow = (): void => handler(true);
  const onHide = (): void => handler(false);
  wx.onShow?.(onShow);
  wx.onHide?.(onHide);
  return () => {
    wx.offShow?.(onShow);
    wx.offHide?.(onHide);
  };
}

export interface ProbeContextOptions {
  /**
   * Allow falling back to a *second* `wx.createCanvas()` when the offscreen
   * probe cannot answer. This is only safe AFTER the on-screen canvas has been
   * taken, because WeChat then guarantees every later `createCanvas()` returns
   * an off-screen canvas. Callers must opt in explicitly (see ADR-0007).
   */
  allowCanvasFallback?: boolean;
  /**
   * The on-screen canvas, when the caller already holds it.
   *
   * WeChat returns the *on-screen* canvas from the first `createCanvas()` call.
   * A host that seeded the canvas through `GameGlobal.screencanvas` never
   * consumes that first call, so the fallback below can receive the screen
   * canvas back. Probing it would create a context on it and then destroy it
   * with `WEBGL_lose_context` — a black screen with no error. When the returned
   * canvas is this object the probe gives up instead of touching it.
   */
  screenCanvas?: WxCanvas;
}

/** Try one canvas; returns `false` when the context is simply unavailable. */
function probeRawContext(raw: WxCanvas, type: ContextType): boolean {
  const ctx = raw.getContext(type);
  if (!ctx) return false;
  // Release GPU resources as soon as possible on constrained devices.
  const lose = (ctx as { getExtension?: (name: string) => { loseContext?: () => void } | null }).getExtension;
  lose?.call(ctx, 'WEBGL_lose_context')?.loseContext?.();
  return true;
}

/**
 * WebGL2 / WebGL1 capability probe.
 *
 * The offscreen canvas is preferred because it has no side effects on the
 * on-screen canvas. But offscreen support is NOT the same capability as
 * on-screen support: a base library can render WebGL2 on the screen canvas while
 * `createOffscreenCanvas` is missing or cannot create a WebGL2 context. So when
 * the offscreen answer is missing or negative and the caller allows it, we ask
 * the real canvas type as well.
 *
 * Returns `undefined` when the host cannot answer — callers must treat that as
 * "unknown", never as "unsupported".
 */
export function probeContext(
  wx: WxLike,
  type: ContextType,
  options: ProbeContextOptions = {},
): boolean | undefined {
  let offscreen: boolean | undefined;
  if (typeof wx.createOffscreenCanvas === 'function') {
    try {
      offscreen = probeRawContext(wx.createOffscreenCanvas({ width: 1, height: 1, type }), type);
    } catch {
      // Some base libraries expose the API but throw for webgl2; keep probing.
      offscreen = undefined;
    }
  }
  if (offscreen === true) return true;
  if (options.allowCanvasFallback && typeof wx.createCanvas === 'function') {
    try {
      const raw = wx.createCanvas();
      // Identity check, not a heuristic: the screen canvas must never be
      // probed, because probing creates a context and then loses it.
      if (options.screenCanvas && raw === options.screenCanvas) return undefined;
      return probeRawContext(raw, type);
    } catch {
      return undefined;
    }
  }
  return offscreen;
}

export function createOffscreenCanvasRaw(
  wx: WxLike,
  width: number,
  height: number,
  type: ContextType,
  diagnostics?: Diagnostics,
): WxCanvas {
  if (typeof wx.createOffscreenCanvas === 'function') {
    try {
      const raw = wx.createOffscreenCanvas({ width, height, type });
      raw.width = width;
      raw.height = height;
      return raw;
    } catch (error) {
      diagnostics?.warn(`createOffscreenCanvas(${type}) failed, falling back to 2d`, error);
    }
  }
  // Last resort for old base libraries: createCanvas() after the first call is
  // guaranteed to be off-screen, but it still counts against the canvas budget.
  if (typeof wx.createCanvas !== 'function') {
    throw new Error('[mini-three-adapter] no canvas creation API available');
  }
  const raw = wx.createCanvas();
  raw.width = width;
  raw.height = height;
  return raw;
}

export function rectFromWindowInfo(wx: WxLike): Rect {
  const info = wx.getWindowInfo?.() ?? wx.getSystemInfoSync?.() ??
    { windowWidth: 0, windowHeight: 0, pixelRatio: 1 };
  return {
    left: 0,
    top: 0,
    width: info.windowWidth,
    height: info.windowHeight,
    right: info.windowWidth,
    bottom: info.windowHeight,
  };
}

export function rectFromSelectorResult(result: {
  width?: number; height?: number; top?: number; left?: number; right?: number; bottom?: number;
}): Rect {
  const width = result.width ?? 0;
  const height = result.height ?? 0;
  const left = result.left ?? 0;
  const top = result.top ?? 0;
  return {
    width, height, left, top,
    right: result.right ?? left + width,
    bottom: result.bottom ?? top + height,
  };
}
