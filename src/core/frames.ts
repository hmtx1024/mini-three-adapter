/** Frame scheduler: rAF wrapper with delta time, FPS cap and measured FPS. */
import type { FrameHandle, FrameScheduler } from '../types';

export interface FrameSchedulerOptions {
  now?: () => number;
  /** Cap logical frames per second (0 = uncapped). */
  fpsCap?: number;
  /** Emit a warning when a frame takes longer than this (ms). 0 disables. */
  slowFrameThreshold?: number;
  onSlowFrame?: (durationMs: number) => void;
}

export function createFrameScheduler(
  request: (callback: (time: number) => void) => number,
  cancel: (id: number) => void,
  options: FrameSchedulerOptions = {},
): FrameScheduler {
  const now = options.now ?? (() => Date.now());
  let fpsCap = options.fpsCap ?? 0;
  let measuredFps = 0;
  let disposed = false;
  const active = new Set<number>();

  const state = {
    get fps(): number {
      return measuredFps;
    },
    request(callback: (time: number) => void): number {
      if (disposed) return -1;
      const id = request((time) => {
        active.delete(id);
        if (!disposed) callback(time);
      });
      active.add(id);
      return id;
    },
    cancel(id: number): void {
      if (active.delete(id)) cancel(id);
    },
    loop(callback: (deltaMs: number, time: number) => void): FrameHandle {
      let last = 0;
      let lastAccepted = 0;
      let handle = -1;
      let running = true;
      const minDelta = () => (fpsCap > 0 ? 1000 / fpsCap : 0);
      const tick = (time: number): void => {
        if (!running || disposed) return;
        handle = state.request(tick);
        const t = typeof time === 'number' && Number.isFinite(time) ? time : now();
        const delta = last === 0 ? 16.67 : t - last;
        if (t - lastAccepted < minDelta()) return;
        lastAccepted = t;
        last = t;
        measuredFps = delta > 0 ? measuredFps * 0.9 + (1000 / delta) * 0.1 : measuredFps;
        const started = now();
        callback(delta, t);
        const duration = now() - started;
        if (options.slowFrameThreshold && duration > options.slowFrameThreshold) {
          options.onSlowFrame?.(duration);
        }
      };
      handle = state.request(tick);
      return {
        cancel: () => {
          running = false;
          state.cancel(handle);
        },
      };
    },
    setFpsCap(fps: number): void {
      fpsCap = Math.max(0, Number.isFinite(fps) ? fps : 0);
    },
    dispose(): void {
      disposed = true;
      for (const id of active) cancel(id);
      active.clear();
    },
  };
  return state;
}
