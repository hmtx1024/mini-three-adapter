/**
 * H5 native event target (ADR-0010).
 *
 * A real `HTMLCanvasElement` already owns a working event system. Patching
 * `MiniEventTarget` onto it replaces that system with a private listener map
 * that the browser never calls, so every real pointer / touch / wheel /
 * webglcontextlost event is lost. These cases describe the intended behaviour;
 * they fail against the current implementation and are the red half of TDD.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createBrowserRuntime } from '../src/platforms/browser';
import { createWeChatGameRuntime, resetScreenCanvasCache } from '../src/platforms/wechat-game';
import type { MiniThreeRuntime } from '../src/core/runtime';
import { MiniPointerEvent } from '../src/polyfills/event';
import { MockNativeCanvas } from './helpers/mock-native-canvas';
import { createMockWx, type MockWx } from './helpers/mock-wx';

let runtime: MiniThreeRuntime | null = null;
let wx: MockWx | null = null;

afterEach(() => {
  runtime?.dispose();
  runtime = null;
  wx = null;
  resetScreenCanvasCache();
});

async function setupBrowser(canvas = new MockNativeCanvas()): Promise<{
  canvas: MockNativeCanvas;
  runtime: MiniThreeRuntime;
}> {
  runtime = await createBrowserRuntime({
    canvas: canvas as unknown as HTMLCanvasElement,
    logLevel: 'silent',
  });
  return { canvas, runtime };
}

describe('browser runtime keeps the native event target', () => {
  it('does not overwrite addEventListener / dispatchEvent on a real canvas', async () => {
    const canvas = new MockNativeCanvas();
    const nativeAdd = canvas.addEventListener;
    const nativeDispatch = canvas.dispatchEvent;

    await setupBrowser(canvas);

    expect(canvas.addEventListener).toBe(nativeAdd);
    expect(canvas.dispatchEvent).toBe(nativeDispatch);
    expect(Object.prototype.hasOwnProperty.call(canvas, 'addEventListener')).toBe(false);
  });

  it('leaves style and getBoundingClientRect to the host', async () => {
    const canvas = new MockNativeCanvas();
    const nativeStyle = canvas.style;
    const nativeRect = canvas.getBoundingClientRect;

    await setupBrowser(canvas);

    expect(canvas.style).toBe(nativeStyle);
    expect(canvas.getBoundingClientRect).toBe(nativeRect);
  });

  it('keeps the canvas identity intact', async () => {
    const canvas = new MockNativeCanvas();
    const { runtime: r } = await setupBrowser(canvas);
    expect(r.canvas).toBe(canvas as unknown as HTMLCanvasElement);
  });

  it('delivers a host-dispatched event to an app listener', async () => {
    const canvas = new MockNativeCanvas();
    await setupBrowser(canvas);

    const seen: Event[] = [];
    canvas.addEventListener('pointerdown', (event: Event) => { seen.push(event); });
    canvas.dispatchFromHost(new Event('pointerdown'));

    expect(seen).toHaveLength(1);
  });

  it('does not throw when an app forwards a real DOM event', async () => {
    const canvas = new MockNativeCanvas();
    await setupBrowser(canvas);

    let hits = 0;
    canvas.addEventListener('pointerdown', () => { hits++; });
    const forwarded = new Event('pointerdown');

    // 真实 Event 的 target / currentTarget 只有 getter，写入即 TypeError。
    expect(() => canvas.dispatchEvent(forwarded)).not.toThrow();
    expect(hits).toBe(1);
  });

  it('reaches the runtime contextlost hook from a host event', async () => {
    const { canvas, runtime: r } = await setupBrowser();

    let lost = 0;
    r.on('contextlost', () => { lost++; });
    canvas.dispatchFromHost(new Event('webglcontextlost'));

    expect(lost).toBe(1);
  });

  it('dispatches real DOM events from the pointer bridge', async () => {
    const { canvas, runtime: r } = await setupBrowser();

    const received: Event[] = [];
    canvas.addEventListener('pointerdown', (event: Event) => { received.push(event); });

    r.handleTouch({
      type: 'touchstart',
      changedTouches: [{ identifier: 3, clientX: 40, clientY: 60 }],
      touches: [{ identifier: 3, clientX: 40, clientY: 60 }],
    });

    expect(received).toHaveLength(1);
    const event = received[0] as PointerEvent;
    // 必须是宿主的事件类型，不能是 Mini 事件：Mini 事件无法被原生监听器理解，
    // 也无法被 `dispatchEvent` 之外的任何 DOM 机制处理。
    expect(event).toBeInstanceOf(Event);
    expect(event).not.toBeInstanceOf(MiniPointerEvent);
    expect(event.clientX).toBe(40);
    expect(event.clientY).toBe(60);
    expect(event.pointerId).toBe(3);
  });

  it('still delivers bridge events when the app only listens on the canvas', async () => {
    const { canvas, runtime: r } = await setupBrowser();

    let moves = 0;
    canvas.addEventListener('pointermove', () => { moves++; });
    r.handleTouch({
      type: 'touchmove',
      changedTouches: [{ identifier: 1, clientX: 11, clientY: 22 }],
      touches: [{ identifier: 1, clientX: 11, clientY: 22 }],
    });

    expect(moves).toBe(1);
  });

  it('does not fan out to the scoped document / window shims', async () => {
    const { runtime: r } = await setupBrowser();

    let onDocument = 0;
    let onWindow = 0;
    r.document.addEventListener('pointerdown', () => { onDocument++; });
    r.scope.addEventListener('pointerdown', () => { onWindow++; });

    r.handleTouch({
      type: 'touchstart',
      changedTouches: [{ identifier: 1, clientX: 5, clientY: 5 }],
      touches: [{ identifier: 1, clientX: 5, clientY: 5 }],
    });

    // 浏览器自己会冒泡；再往假对象上转一份只会重复派发。
    expect(onDocument).toBe(0);
    expect(onWindow).toBe(0);
  });

  it('dispatches wheel as a real event with deltaY', async () => {
    const { canvas, runtime: r } = await setupBrowser();

    const seen: Event[] = [];
    canvas.addEventListener('wheel', (event: Event) => { seen.push(event); });
    r.bridge.dispatchMouse({ type: 'wheel', deltaY: -120, clientX: 7, clientY: 8 });

    expect(seen).toHaveLength(1);
    const event = seen[0] as WheelEvent;
    expect(event).toBeInstanceOf(Event);
    expect(event.type).toBe('wheel');
    expect(event.deltaY).toBe(-120);
  });

  it('creates extra canvases without breaking their event methods', async () => {
    const { runtime: r } = await setupBrowser();
    const extra = r.createCanvas(16, 16, '2d') as unknown as Record<string, unknown>;
    expect(typeof extra.addEventListener).toBe('function');
    expect(typeof extra.dispatchEvent).toBe('function');
  });
});

describe('mini game runtime keeps the shim behaviour', () => {
  it('still installs MiniEventTarget on a bare wx canvas', async () => {
    wx = createMockWx();
    runtime = await createWeChatGameRuntime({
      wx,
      logLevel: 'silent',
      capabilities: { webgl2: true },
    });

    const canvas = runtime.canvas as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(canvas, 'addEventListener')).toBe(true);
    // 裸 wx canvas 没有原生事件系统，shim 必须接受普通对象形态的事件。
    expect((canvas as { dispatchEvent(event: unknown): boolean }).dispatchEvent({ type: 'ping' })).toBe(true);
  });

  it('still patches style and getBoundingClientRect on a wx canvas', async () => {
    wx = createMockWx();
    runtime = await createWeChatGameRuntime({
      wx,
      logLevel: 'silent',
      capabilities: { webgl2: true },
    });

    expect(runtime.canvas.style.width).toBe('375px');
    expect(runtime.canvas.getBoundingClientRect().width).toBe(375);
  });
});
