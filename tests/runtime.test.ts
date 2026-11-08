import { afterEach, describe, expect, it } from 'vitest';
import {
  createWeChatGameRuntime,
  resetScreenCanvasCache,
} from '../src/platforms/wechat-game';
import { getActiveScope } from '../src/scope';
import { MiniPointerEvent } from '../src/polyfills/event';
import type { MiniThreeRuntime } from '../src/core/runtime';
import { createMockWx, type MockWx } from './helpers/mock-wx';

let runtime: MiniThreeRuntime | null = null;
let wx: MockWx;

afterEach(() => {
  runtime?.dispose();
  runtime = null;
  resetScreenCanvasCache();
});

async function setup(): Promise<MiniThreeRuntime> {
  wx = createMockWx();
  runtime = await createWeChatGameRuntime({ wx, logLevel: 'silent', capabilities: { webgl2: true } });
  return runtime;
}

describe('mini game runtime', () => {
  it('patches the canvas in place and exposes DOM-ish properties', async () => {
    const r = await setup();
    expect(r.canvas).toBe(wx.__canvases[0]);
    expect(r.canvas.clientWidth).toBe(375);
    expect(r.canvas.clientHeight).toBe(667);
    const rect = r.canvas.getBoundingClientRect();
    expect(rect.width).toBe(375);
    expect(r.canvas.style.width).toBe('375px');
    expect(r.canvas instanceof (r.scope.HTMLCanvasElement as never)).toBe(true);
  });

  it('populates a scoped environment without polluting globalThis', async () => {
    const r = await setup();
    expect(getActiveScope()).toBe(r.scope);
    expect(r.scope.window).toBe(r.scope);
    expect(r.scope.innerWidth).toBe(375);
    expect(r.scope.devicePixelRatio).toBe(2); // capped from 3
    expect(r.scope.document.createElement('canvas')).toBeTruthy();
    expect(r.scope.document.createElement('image')).toBe(wx.__images[0]);
    expect((globalThis as Record<string, unknown>).document).toBeUndefined();
  });

  it('caches WebGL2 context identity and satisfies instanceof', async () => {
    const r = await setup();
    const ctx1 = r.canvas.getContext('webgl2');
    const ctx2 = r.canvas.getContext('webgl2');
    expect(ctx1).toBe(ctx2);
    expect(ctx1 instanceof (r.scope.WebGL2RenderingContext as never)).toBe(true);
  });

  it('bridges wx.onTouchStart into PointerEvents', async () => {
    const r = await setup();
    const events: MiniPointerEvent[] = [];
    r.canvas.addEventListener('pointerdown', (ev: unknown) => { events.push(ev as MiniPointerEvent); });
    wx.__touch.start?.({
      type: 'touchstart',
      changedTouches: [{ identifier: 7, clientX: 40, clientY: 60 }],
      touches: [{ identifier: 7, clientX: 40, clientY: 60 }],
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.pointerId).toBe(7);
    expect(events[0]?.clientX).toBe(40);
    expect(events[0]?.offsetY).toBe(60);
  });

  it('tracks multi-touch and cleans up on touchend', async () => {
    const r = await setup();
    wx.__touch.start?.({ type: 'touchstart', changedTouches: [{ identifier: 1, clientX: 10, clientY: 10 }, { identifier: 2, clientX: 20, clientY: 20 }], touches: [] });
    expect(r.bridge.activePointerCount).toBe(2);
    wx.__touch.end?.({ type: 'touchend', changedTouches: [{ identifier: 1, clientX: 10, clientY: 10 }], touches: [] });
    expect(r.bridge.activePointerCount).toBe(1);
  });

  it('installGlobals is reversible and scoped by default', async () => {
    const r = await setup();
    const restore = r.installGlobals();
    expect((globalThis as Record<string, unknown>).window).toBe(r.scope);
    expect((globalThis as Record<string, unknown>).document).toBe(r.document);
    restore();
    expect((globalThis as Record<string, unknown>).window).toBeUndefined();
  });

  it('emits resize and dispose events, and fully tears down', async () => {
    const r = await setup();
    let resized = 0;
    let disposed = 0;
    r.on('resize', () => { resized++; });
    r.on('dispose', () => { disposed++; });
    wx.__setSize(414, 896);
    for (const listener of wx.__resize) listener();
    expect(resized).toBe(1);
    expect(r.windowInfo.width).toBe(414);
    await r.resize();
    r.dispose();
    expect(disposed).toBe(1);
    expect(r.disposed).toBe(true);
    expect(wx.__touch.start).toBeUndefined();
    runtime = null;
  });

  it('produces a capability report', async () => {
    const r = await setup();
    expect(r.report()).toContain('wechat-game');
    expect(r.report()).toContain('WebGL2');
  });
});
