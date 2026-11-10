/** WeChat Mini Program (小程序, canvas type="webgl2") platform binding. */
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
  rectFromSelectorResult,
  watchWxVisibility,
} from './wechat-common';
import { resolveWx, type WxCanvas, type WxLike, type WxSelectorQuery, type WxSelectorQueryResult } from './wx-types';

export interface SelectorCtx {
  createSelectorQuery(): WxSelectorQuery;
}

export interface WeChatMiniProgramOptions {
  wx?: WxLike;
  /** CSS selector of the `<canvas type="webgl2">` node. */
  selector: string;
  /** Inside a custom component, pass `this` so the query is scoped correctly. */
  selectorCtx?: SelectorCtx;
  /** Milliseconds to wait for layout before querying (uni-app needs a tick). */
  queryDelay?: number;
  capabilities?: Partial<Capabilities>;
  diagnostics?: Diagnostics;
}

function queryNode(
  ctx: SelectorCtx | WxLike,
  selector: string,
  delay: number,
): Promise<{ node: WxCanvas; result: WxSelectorQueryResult }> {
  return new Promise((resolve, reject) => {
    const run = (): void => {
      try {
        const create = ctx.createSelectorQuery;
        if (typeof create !== 'function') {
          reject(new Error('[mini-three-adapter] createSelectorQuery is unavailable; pass a valid selectorCtx'));
          return;
        }
        const query = create.call(ctx);
        query
          .select(selector)
          .fields({ node: true, id: true, rect: true, size: true })
          .exec((results) => {
            const result = results?.[0];
            if (!result?.node) {
              reject(new Error(
                `[mini-three-adapter] selector "${selector}" returned no canvas node. ` +
                  'Ensure <canvas type="webgl2" id="..."> exists and the component is rendered.',
              ));
              return;
            }
            resolve({ node: result.node, result });
          });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    if (delay > 0) setTimeout(run, delay);
    else run();
  });
}

export async function createWeChatMiniProgramBinding(
  options: WeChatMiniProgramOptions,
): Promise<PlatformBinding> {
  const wx = resolveWx(options.wx);
  const diagnostics = options.diagnostics ?? createDiagnostics('warn');
  const ctx = options.selectorCtx ?? wx;
  const { node, result } = await queryNode(ctx, options.selector, options.queryDelay ?? 0);
  const rawCanvas = node;
  const capabilities = detectCapabilities(wx, 'wechat-miniprogram', {
    overrides: options.capabilities,
    diagnostics,
    // No createCanvas() fallback here: the canvas node comes from a selector
    // query and probing it directly would create the real GL context with
    // default attributes before three.js asks for its own.
    probeContext: (type) => probeContext(wx, type),
  });
  const imageFactory = createWechatImageFactory(wx, diagnostics);
  const raf = createRafPair(wx, rawCanvas);
  const now = createNow(wx);
  let lastRect = rectFromSelectorResult(result);

  const getCanvasRect = async (): Promise<Rect> => {
    const fresh = await queryNode(ctx, options.selector, 0);
    lastRect = rectFromSelectorResult(fresh.result);
    return lastRect;
  };

  const watchVisibility = (handler: (visible: boolean) => void): Disposer => {
    const host = wx as Record<string, unknown>;
    const onShow = (): void => handler(true);
    const onHide = (): void => handler(false);
    if (typeof host.onAppShow === 'function') (host.onAppShow as (l: () => void) => void).call(wx, onShow);
    if (typeof host.onAppHide === 'function') (host.onAppHide as (l: () => void) => void).call(wx, onHide);
    const fallback = watchWxVisibility(wx, handler);
    return () => {
      if (typeof host.offAppShow === 'function') (host.offAppShow as (l: () => void) => void).call(wx, onShow);
      if (typeof host.offAppHide === 'function') (host.offAppHide as (l: () => void) => void).call(wx, onHide);
      fallback();
    };
  };

  diagnostics.info('mini program canvas resolved', { selector: options.selector, rect: lastRect });

  return {
    kind: 'wechat-miniprogram',
    wx,
    rawCanvas,
    capabilities,
    imageFactory,
    getCanvasRect,
    createOffscreenCanvas: (width: number, height: number, type: ContextType) =>
      createOffscreenCanvasRaw(wx, width, height, type, diagnostics),
    // Mini programs deliver touch events through WXML bindings, not wx.onTouch*.
    // The app must forward them: <canvas @touchstart="runtime.handleTouch" ... />
    watchTouch: (_handler: (event: TouchLikeEvent) => void): Disposer => () => undefined,
    watchVisibility,
    requestAnimationFrame: raf.request,
    cancelAnimationFrame: raf.cancel,
    now,
    dispose: () => diagnostics.debug('wechat-miniprogram binding disposed'),
  };
}

export type WeChatMiniProgramRuntimeOptions = WeChatMiniProgramOptions & RuntimeOptions;

export function createWeChatMiniProgramRuntime(
  options: WeChatMiniProgramRuntimeOptions,
): Promise<MiniThreeRuntime> {
  return createRuntime(() => createWeChatMiniProgramBinding(options), options);
}
