/**
 * mini-three-adapter — public umbrella entry.
 *
 * Prefer subpath imports in production so tree-shaking can drop unused
 * platforms: `mini-three-adapter/wechat-game`, `/wechat-miniprogram`, `/browser`.
 */
export * from './core/index';
export type * from './types';
export {
  createScope,
  getActiveScope,
  setActiveScope,
  hasActiveScope,
  installGlobals,
  getEarlyScopeReads,
  clearEarlyScopeReads,
} from './scope';
export type {
  MiniThreeScope,
  DocumentLike,
  ElementLike,
  NavigatorLike,
  InstallGlobalsOptions,
} from './scope';

export {
  createWeChatGameRuntime,
  createWeChatGameBinding,
  getScreenCanvas,
  resetScreenCanvasCache,
} from './platforms/wechat-game';
export type { WeChatGameOptions, WeChatGameRuntimeOptions } from './platforms/wechat-game';

export {
  createWeChatMiniProgramRuntime,
  createWeChatMiniProgramBinding,
} from './platforms/wechat-miniprogram';
export type {
  WeChatMiniProgramOptions,
  WeChatMiniProgramRuntimeOptions,
  SelectorCtx,
} from './platforms/wechat-miniprogram';

export { createBrowserRuntime, createBrowserBinding } from './platforms/browser';
export type { BrowserPlatformOptions, BrowserRuntimeOptions } from './platforms/browser';

export { resolveWx } from './platforms/wx-types';
export type {
  WxLike,
  WxCanvas,
  WxImage,
  WxWindowInfo,
  WxTouchEvent,
  WxTouchPoint,
  WxRect,
  WxRequestOptions,
  WxRequestResult,
  WxSelectorQuery,
  WxSelectorQueryResult,
} from './platforms/wx-types';
