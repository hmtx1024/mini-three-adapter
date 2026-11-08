/** Observable window metrics with devicePixelRatio clamping and resize events. */
import type { WxLike, WxWindowInfo } from '../platforms/wx-types';
import type { Disposer, Rect, WindowInfo } from '../types';
import type { Diagnostics } from './diagnostics';

export interface WindowInfoStore {
  readonly info: WindowInfo;
  /** Force a re-read (e.g. after orientation change). Returns true if changed. */
  refresh(): boolean;
  onChange(listener: (info: WindowInfo) => void): Disposer;
  setPixelRatioCap(cap: number): void;
  dispose(): void;
}

export interface WindowInfoOptions {
  pixelRatioCap?: number;
  diagnostics?: Diagnostics;
}

export function readWindowInfo(wx: WxLike, pixelRatioCap = 2): WindowInfo {
  const raw: WxWindowInfo = wx.getWindowInfo
    ? wx.getWindowInfo()
    : wx.getSystemInfoSync
      ? wx.getSystemInfoSync()
      : { windowWidth: 0, windowHeight: 0, pixelRatio: 1 };
  const width = raw.windowWidth || raw.screenWidth || 0;
  const height = raw.windowHeight || raw.screenHeight || 0;
  const rawPixelRatio = raw.pixelRatio || 1;
  const safeArea: Rect | undefined = raw.safeArea
    ? {
        top: raw.safeArea.top,
        left: raw.safeArea.left,
        width: raw.safeArea.width,
        height: raw.safeArea.height,
        right: raw.safeArea.right,
        bottom: raw.safeArea.bottom,
      }
    : undefined;
  return {
    width,
    height,
    pixelRatio: Math.min(rawPixelRatio, pixelRatioCap > 0 ? pixelRatioCap : rawPixelRatio),
    rawPixelRatio,
    ...(safeArea ? { safeArea } : {}),
  };
}

export function createWindowInfoStore(
  wx: WxLike,
  options: WindowInfoOptions = {},
): WindowInfoStore {
  let cap = options.pixelRatioCap ?? 2;
  let current = readWindowInfo(wx, cap);
  const listeners = new Set<(info: WindowInfo) => void>();
  let disposed = false;

  const publish = (next: WindowInfo): void => {
    const changed =
      next.width !== current.width ||
      next.height !== current.height ||
      next.pixelRatio !== current.pixelRatio;
    current = next;
    if (changed) for (const listener of Array.from(listeners)) listener(current);
  };

  const refresh = (): boolean => {
    const next = readWindowInfo(wx, cap);
    const changed =
      next.width !== current.width ||
      next.height !== current.height ||
      next.pixelRatio !== current.pixelRatio;
    publish(next);
    return changed;
  };

  const resizeListener = (): void => { refresh(); };
  const canWatch = typeof wx.onWindowResize === 'function';
  if (canWatch) wx.onWindowResize?.(resizeListener);
  else options.diagnostics?.warnOnce(
    'no-window-resize',
    'wx.onWindowResize unavailable; call runtime.resize() manually after orientation changes.',
  );

  return {
    get info() {
      return current;
    },
    refresh,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setPixelRatioCap(value: number) {
      cap = value;
      refresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (canWatch) wx.offWindowResize?.(resizeListener);
      listeners.clear();
    },
  };
}
