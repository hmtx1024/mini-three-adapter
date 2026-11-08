/** WeChat Mini Game (小游戏) platform binding. */
import type { Capabilities, ContextType, Disposer, Rect, TouchLikeEvent } from '../types';
import type { PlatformBinding } from '../core/platform';
import { createRuntime, type MiniThreeRuntime, type RuntimeOptions } from '../core/runtime';
import { detectCapabilities } from '../core/capabilities';
import { createDiagnostics, type Diagnostics } from '../core/diagnostics';
import {
  createNow,
  createOffscreenCanvasRaw,
  createRafPair,
  createWechatImageFactory,
  probeContext,
  rectFromWindowInfo,
  watchWxTouch,
  watchWxVisibility,
} from './wechat-common';
import { resolveWx, type WxCanvas, type WxLike } from './wx-types';

export interface WeChatGameOptions {
  /** Inject a `wx` mock (tests / non-WeChat hosts). */
  wx?: WxLike;
  /**
   * Reuse an existing on-screen canvas. If omitted, the adapter checks
   * `GameGlobal.screencanvas`, `globalThis.canvas` (weapp-adapter) and finally
   * calls `wx.createCanvas()` exactly once.
   */
  canvas?: WxCanvas;
  capabilities?: Partial<Capabilities>;
  diagnostics?: Diagnostics;
  /** Call wx.setPreferredFramesPerSecond(fps) when supported. */
  preferredFps?: number;
}

let cachedScreenCanvas: WxCanvas | null = null;

/** Resolve (and memoize) the single on-screen canvas. */
export function getScreenCanvas(wx: WxLike, supplied?: WxCanvas): WxCanvas {
  if (supplied) return supplied;
  if (cachedScreenCanvas) return cachedScreenCanvas;
  const host = globalThis as unknown as Record<string, unknown>;
  const gameGlobal = host.GameGlobal as Record<string, unknown> | undefined;
  const existing = (gameGlobal?.screencanvas ?? host.canvas) as WxCanvas | undefined;
  if (existing && typeof existing.getContext === 'function') {
    cachedScreenCanvas = existing;
    return existing;
  }
  if (typeof wx.createCanvas !== 'function') {
    throw new Error('[mini-three-adapter] wx.createCanvas is missing: this is not a WeChat Mini Game runtime');
  }
  cachedScreenCanvas = wx.createCanvas();
  return cachedScreenCanvas;
}

/** Only for tests: forget the memoized screen canvas. */
export function resetScreenCanvasCache(): void {
  cachedScreenCanvas = null;
}

export function createWeChatGameBinding(options: WeChatGameOptions = {}): PlatformBinding {
  const wx = resolveWx(options.wx);
  const diagnostics = options.diagnostics ?? createDiagnostics('warn');
  const rawCanvas = getScreenCanvas(wx, options.canvas);
  const capabilities = detectCapabilities(wx, 'wechat-game', {
    overrides: options.capabilities,
    probeContext: (type) => probeContext(wx, type),
  });
  const imageFactory = createWechatImageFactory(wx, diagnostics);
  const raf = createRafPair(wx, rawCanvas);
  const now = createNow(wx);

  if (options.preferredFps && typeof wx.setPreferredFramesPerSecond === 'function') {
    wx.setPreferredFramesPerSecond(options.preferredFps);
  }

  const getCanvasRect = (): Rect => rectFromWindowInfo(wx);

  return {
    kind: 'wechat-game',
    wx,
    rawCanvas,
    capabilities,
    imageFactory,
    getCanvasRect,
    createOffscreenCanvas: (width: number, height: number, type: ContextType) =>
      createOffscreenCanvasRaw(wx, width, height, type, diagnostics),
    watchTouch: (handler: (event: TouchLikeEvent) => void): Disposer => watchWxTouch(wx, handler),
    watchVisibility: (handler) => watchWxVisibility(wx, handler),
    requestAnimationFrame: raf.request,
    cancelAnimationFrame: raf.cancel,
    now,
    dispose: () => {
      // The on-screen canvas belongs to the game; never destroy it here.
      diagnostics.debug('wechat-game binding disposed');
    },
  };
}

export type WeChatGameRuntimeOptions = WeChatGameOptions & RuntimeOptions;

/** One-line bootstrap for mini games. */
export function createWeChatGameRuntime(
  options: WeChatGameRuntimeOptions = {},
): Promise<MiniThreeRuntime> {
  return createRuntime(() => createWeChatGameBinding(options), options);
}
