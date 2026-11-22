import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageFactory } from '../src/core/image';
import { createDiagnostics } from '../src/core/diagnostics';
import { MiniBlob, MiniURL } from '../src/polyfills/blob-url';
import { createMockWx } from './helpers/mock-wx';
import type { WxLike } from '../src/platforms/wx-types';

/** A host whose image object really implements addEventListener (no onload slot). */
function hostWithNativeEventTarget(): {
  raw: Record<string, unknown>;
  emit(type: 'load' | 'error', payload?: unknown): void;
} {
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  let src = '';
  const raw: Record<string, unknown> = {
    width: 0,
    height: 0,
    get src() { return src; },
    set src(next: string) { src = next; },
    addEventListener(type: string, listener: (event?: unknown) => void) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
    removeEventListener(type: string, listener: (event?: unknown) => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  return {
    raw,
    emit(type, payload) {
      for (const listener of Array.from(listeners.get(type) ?? [])) listener(payload ?? { type });
    },
  };
}

/** A host that hides the event slots behind non-writable properties. */
function hostWithoutEventPath(srcIsDataProperty = false): Record<string, unknown> {
  let src = '';
  const raw: Record<string, unknown> = srcIsDataProperty
    ? { width: 0, height: 0, src: '' }
    : {
        width: 0,
        height: 0,
        get src() { return src; },
        set src(next: string) { src = next; },
      };
  Object.defineProperty(raw, 'onload', { value: null, writable: false, configurable: false });
  Object.defineProperty(raw, 'onerror', { value: null, writable: false, configurable: false });
  return raw;
}

/**
 * The reported device shape: `Object.getOwnPropertyDescriptor(img, 'onload')`
 * answers `undefined`, yet `img.onload = fn` is still accepted and fired by the
 * native loader. A Proxy is the only way to reproduce "invisible descriptor,
 * working setter" without a real device.
 */
function hostWithHiddenCallbackSlots(): {
  raw: Record<string, unknown>;
  emit(type: 'load' | 'error', payload?: unknown): void;
} {
  const stored = new Map<string, unknown>();
  let src = '';
  const target: Record<string, unknown> = {
    width: 0,
    height: 0,
    get src() { return src; },
    set src(next: string) { src = next; },
  };
  const raw = new Proxy(target, {
    get(t, key, receiver) {
      if ((key === 'onload' || key === 'onerror') && !Object.prototype.hasOwnProperty.call(t, key)) {
        return stored.get(key);
      }
      return Reflect.get(t, key, receiver);
    },
    set(t, key, value) {
      // Accept the write into the native slot only while nothing shadows it;
      // once the shim accessor exists, normal [[Set]] must reach that accessor.
      if ((key === 'onload' || key === 'onerror') && !Object.prototype.hasOwnProperty.call(t, key)) {
        stored.set(key, value);
        return true;
      }
      return Reflect.set(t, key, value);
    },
    getOwnPropertyDescriptor(t, key) {
      if (key === 'onload' || key === 'onerror') return undefined;
      return Reflect.getOwnPropertyDescriptor(t, key);
    },
  });
  return {
    raw,
    emit(type, payload) {
      const handler = stored.get(type === 'load' ? 'onload' : 'onerror');
      if (typeof handler === 'function') (handler as (event?: unknown) => void)(payload ?? { type });
    },
  };
}

/**
 * The remaining edge case: the host accepts `img.onload = fn` (so the slot is
 * "wired") and then never calls it. Nothing observable distinguishes this from a
 * load that is merely slow — only the watchdog can.
 */
function hostWithSilentCallbackSlots(complete = false): Record<string, unknown> {
  const slots: Record<string, unknown> = {};
  let src = '';
  return {
    width: 0,
    height: 0,
    get src() { return src; },
    set src(next: string) { src = next; },
    get onload() { return slots.onload ?? null; },
    set onload(next: unknown) { slots.onload = next; },
    get onerror() { return slots.onerror ?? null; },
    set onerror(next: unknown) { slots.onerror = next; },
    get complete() { return complete; },
  };
}

/**
 * The real-device shape (2026-11-21 field report): the host does NOT keep the
 * assignment in an internal slot. When the image finishes it READS
 * `image.onload` and calls whatever the property returns. The object starts
 * without any `onload` member; tier-2 of the bridge turns the assignment into
 * an own data property, which the shim accessor then replaces — so what the
 * host reads back at trigger time is exactly what our getter answers.
 */
function hostWithReadTimeCallbacks(): {
  raw: Record<string, unknown>;
  emit(type: 'load' | 'error', payload?: unknown): void;
} {
  let src = '';
  const raw: Record<string, unknown> = {
    width: 0,
    height: 0,
    get src() { return src; },
    set src(next: string) { src = next; },
  };
  return {
    raw,
    emit(type, payload) {
      const handler = raw[`on${type}`];
      if (typeof handler === 'function') (handler as (event?: unknown) => void)(payload ?? { type });
    },
  };
}

/**
 * A host that does BOTH: the assignment lands in a native slot AND the trigger
 * reads the property back. The bridge must settle once and deliver the user
 * handler once — not once per path.
 */
function hostThatStoresAndReads(): {
  raw: Record<string, unknown>;
  emit(type: 'load' | 'error', payload?: unknown): void;
} {
  let load: ((event?: unknown) => void) | null = null;
  let error: ((event?: unknown) => void) | null = null;
  let src = '';
  const raw: Record<string, unknown> = {
    width: 0,
    height: 0,
    get src() { return src; },
    set src(next: string) { src = next; },
    get onload() { return load; },
    set onload(next: unknown) { load = typeof next === 'function' ? next as (event?: unknown) => void : null; },
    get onerror() { return error; },
    set onerror(next: unknown) { error = typeof next === 'function' ? next as (event?: unknown) => void : null; },
  };
  return {
    raw,
    emit(type, payload) {
      const stored = type === 'load' ? load : error;
      stored?.(payload ?? { type });
      const read = raw[`on${type}`];
      if (typeof read === 'function') (read as (event?: unknown) => void)(payload ?? { type });
    },
  };
}

/**
 * The full real-device shape (2026-11-21 probe): `src` reads as a plain
 * writable DATA property, yet writes go through the host's property
 * interceptor and start the native load — while Object.defineProperty would
 * replace that interceptor with a dead plain property, so the image never
 * loads. `addEventListener` exists but never dispatches image events; the
 * callback slots are read at trigger time. Only a Proxy can model "data
 * descriptor with write side effects" in pure JS.
 */
function hostWithNativeDataSrc(): {
  raw: Record<string, unknown>;
  emit(type: 'load' | 'error', payload?: unknown): void;
  srcWrites(): string[];
  srcDefineCount(): number;
} {
  const state = { src: '' };
  const writes: string[] = [];
  let defineCount = 0;
  const target: Record<string, unknown> = { width: 0, height: 0 };
  // The shell: registers, then never dispatches (the 0.1.8 field report).
  target.addEventListener = () => undefined;
  const raw = new Proxy(target, {
    get(t, key, receiver) {
      if (key === 'src') return state.src;
      return Reflect.get(t, key, receiver);
    },
    set(t, key, value, receiver) {
      if (key === 'src') {
        writes.push(String(value));
        state.src = String(value);
        return true;
      }
      return Reflect.set(t, key, value, receiver);
    },
    getOwnPropertyDescriptor(t, key) {
      if (key === 'src') {
        return { value: state.src, writable: true, enumerable: true, configurable: true };
      }
      return Reflect.getOwnPropertyDescriptor(t, key);
    },
    defineProperty(t, key, descriptor) {
      if (key === 'src') defineCount += 1;
      return Reflect.defineProperty(t, key, descriptor);
    },
  });
  return {
    raw: raw as unknown as Record<string, unknown>,
    emit(type, payload) {
      const handler = (raw as unknown as Record<string, unknown>)[`on${type}`];
      if (typeof handler === 'function') (handler as (event?: unknown) => void)(payload ?? { type });
    },
    srcWrites: () => writes.slice(),
    srcDefineCount: () => defineCount,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('image native event bridge', () => {
  it('delivers a native load to both onload and addEventListener("load")', () => {
    const wx = createMockWx();
    const image = createImageFactory(wx).createImage();
    const onload = vi.fn();
    const listener = vi.fn();
    image.onload = onload as unknown as typeof image.onload;
    image.addEventListener('load', listener);

    wx.__images[0]!.__emit('load');

    expect(onload).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'load' }));
  });

  it('does not double-dispatch when both onload and a listener exist', () => {
    const wx = createMockWx();
    const image = createImageFactory(wx).createImage();
    let calls = 0;
    image.onload = () => { calls++; };
    image.addEventListener('load', () => { calls++; });
    wx.__images[0]!.__emit('load');
    // one inline handler + one listener
    expect(calls).toBe(2);
  });

  it('resolves decode() once the native load fires', async () => {
    const wx = createMockWx();
    const image = createImageFactory(wx).createImage();
    expect(image.complete).toBe(false);
    const pending = image.decode();
    wx.__images[0]!.__emit('load');
    await expect(pending).resolves.toBeUndefined();
    expect(image.complete).toBe(true);
  });

  it('rejects decode() and keeps the user handler on a native error', async () => {
    const wx = createMockWx();
    const image = createImageFactory(wx).createImage();
    const onerror = vi.fn();
    image.onerror = onerror;
    const pending = image.decode();
    wx.__images[0]!.__emit('error', new Error('bad image'));
    await expect(pending).rejects.toBeDefined();
    expect(onerror).toHaveBeenCalledTimes(1);
  });

  it('reports complete=true after a failure, like a browser', () => {
    const wx = createMockWx();
    const image = createImageFactory(wx).createImage();
    wx.__images[0]!.__emit('error', new Error('bad image'));
    expect(image.complete).toBe(true);
  });

  it('settles exactly once even if the host fires load twice', () => {
    const wx = createMockWx();
    const image = createImageFactory(wx).createImage();
    const listener = vi.fn();
    image.addEventListener('load', listener);
    wx.__images[0]!.__emit('load');
    wx.__images[0]!.__emit('load');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('bridges a host whose onload descriptor is invisible but whose assignment works', () => {
    const host = hostWithHiddenCallbackSlots();
    const wx = { createImage: () => host.raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const listener = vi.fn();
    image.addEventListener('load', listener);
    image.onload = listener as unknown as typeof image.onload;

    image.src = 'textures/normal.png';
    host.emit('load');

    expect(listener).toHaveBeenCalledTimes(2); // listener + inline handler
    expect(image.complete).toBe(true);
  });

  it('uses the host native addEventListener when onload/onerror are not visible', () => {
    const host = hostWithNativeEventTarget();
    const wx = { createImage: () => host.raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const listener = vi.fn();
    image.addEventListener('load', listener);

    image.src = 'textures/normal.png';
    host.emit('load');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'load' }));
    expect(image.complete).toBe(true);
  });

  it('falls back to wx.getImageInfo and fails fast when the host cannot deliver events', async () => {
    const raw = hostWithoutEventPath();
    const getImageInfo = vi.fn((options: { src: string; success?: (info: { width: number; height: number }) => void }) => {
      options.success?.({ width: 64, height: 32 });
    });
    const wx = { createImage: () => raw, getImageInfo } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const onerror = vi.fn();
    image.addEventListener('error', onerror);

    image.src = 'textures/normal.png';

    expect(getImageInfo).toHaveBeenCalledWith(expect.objectContaining({ src: 'textures/normal.png' }));
    expect(onerror).toHaveBeenCalledTimes(1);
    expect(image.complete).toBe(true);
    await expect(image.decode()).rejects.toMatchObject({ reason: 'image-events-unavailable' });
  });

  it('surfaces a getImageInfo decode failure (the WebP case) as an error event', () => {
    const raw = hostWithoutEventPath();
    const wx = {
      createImage: () => raw,
      getImageInfo: (options: { fail?: (error: { errMsg: string }) => void }) => {
        options.fail?.({ errMsg: 'getImageInfo:fail decode error' });
      },
    } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const listener = vi.fn();
    image.addEventListener('error', listener);

    image.src = 'textures/cup9_normal.webp';

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toMatchObject({
      type: 'error',
      detail: { reason: 'getImageInfo-failed' },
    });
  });

  it('dispatches an error from a watchdog when the host has no event path at all', () => {
    vi.useFakeTimers();
    const raw = hostWithoutEventPath();
    const wx = { createImage: () => raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const listener = vi.fn();
    image.addEventListener('error', listener);

    image.src = 'textures/normal.png';
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toMatchObject({ type: 'error' });
  });

  it('fails a host that accepts onload but never calls it', () => {
    vi.useFakeTimers();
    const raw = hostWithSilentCallbackSlots();
    const wx = { createImage: () => raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const listener = vi.fn();
    image.addEventListener('error', listener);

    image.src = 'textures/normal.png';
    // The slot accepted the forwarder, so nothing looks wrong yet.
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toMatchObject({
      type: 'error',
      detail: { reason: 'image-events-timeout', path: 'onload' },
    });
    expect(image.complete).toBe(true);
  });

  it('delivers load from the watchdog when the host reports complete but stays silent', () => {
    vi.useFakeTimers();
    const raw = hostWithSilentCallbackSlots(true);
    const wx = { createImage: () => raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const listener = vi.fn();
    image.addEventListener('load', listener);

    image.src = 'textures/normal.png';
    vi.advanceTimersByTime(2000);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toMatchObject({
      type: 'load',
      detail: { reason: 'watchdog-complete' },
    });
  });

  it('lets a real load win over the watchdog', () => {
    vi.useFakeTimers();
    const wx = createMockWx();
    const image = createImageFactory(wx).createImage();
    const onload = vi.fn();
    image.addEventListener('load', onload);

    image.src = 'textures/normal.png';
    wx.__images[0]!.__emit('load');
    vi.advanceTimersByTime(2000);

    expect(onload).toHaveBeenCalledTimes(1);
  });

  it('leaves a host data-property src untouched so plain writes land natively', () => {
    const raw = hostWithoutEventPath(true);
    const wx = { createImage: () => raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();

    image.src = 'textures/a.png';
    expect(raw.src).toBe('textures/a.png');

    // Every write goes straight to the host property; reads come back native.
    image.src = 'textures/b.png';
    expect(raw.src).toBe('textures/b.png');
    expect(image.src).toBe('textures/b.png');
  });

  it('warns once (not per image) with the host shape when no event path exists', () => {
    const messages: Array<{ message: string; payload?: unknown }> = [];
    const diagnostics = createDiagnostics('warn', (_level, message, payload) => {
      messages.push({ message, payload });
    });
    const raw = hostWithoutEventPath();
    const wx = { createImage: () => raw } as unknown as WxLike;
    const factory = createImageFactory(wx, diagnostics);

    expect(() => factory.createImage()).not.toThrow();
    expect(() => factory.createImage()).not.toThrow();

    const related = messages.filter((entry) => entry.message.includes('onload/onerror'));
    expect(related).toHaveLength(1);
    expect(related[0]!.message).toContain('fallback');
    expect(related[0]!.payload).toMatchObject({
      onload: 'data-readonly',
      src: 'accessor',
      addEventListener: 'missing',
      getImageInfo: 'missing',
    });
  });

  it('answers a callable bridge when the host reads the onload slot at trigger time', () => {
    const host = hostWithReadTimeCallbacks();
    const wx = { createImage: () => host.raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();

    // The invariant the 0.1.7 real-device regression broke: whatever the host
    // reads out of the slot must be callable, with or without a user handler.
    // three's ImageLoader never assigns `img.onload`, it only listens.
    expect(typeof image.onload).toBe('function');
    expect(typeof image.onerror).toBe('function');
  });

  it('bridges a host that reads image.onload at trigger time (real-device shape)', () => {
    const host = hostWithReadTimeCallbacks();
    const wx = { createImage: () => host.raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const listener = vi.fn();
    image.addEventListener('load', listener);

    image.src = 'textures/normal.png';
    host.emit('load');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'load' }));
    expect(image.complete).toBe(true);
  });

  it('delivers an app-assigned onload exactly once when the host reads the slot', () => {
    const host = hostWithReadTimeCallbacks();
    const wx = { createImage: () => host.raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const user = vi.fn();
    const listener = vi.fn();
    image.onload = user as unknown as typeof image.onload;
    image.addEventListener('load', listener);

    image.src = 'textures/normal.png';
    host.emit('load');

    expect(user).toHaveBeenCalledTimes(1);
    expect(user.mock.calls[0]![0]).toMatchObject({ type: 'load' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(image.complete).toBe(true);
  });

  it('settles exactly once on a host that both stores the assignment and reads the slot', () => {
    const host = hostThatStoresAndReads();
    const wx = { createImage: () => host.raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const user = vi.fn();
    const listener = vi.fn();
    image.onload = user as unknown as typeof image.onload;
    image.addEventListener('load', listener);

    image.src = 'textures/normal.png';
    host.emit('load');

    expect(user).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(image.complete).toBe(true);
  });

  it('warns once with the event path and src when the watchdog times out', () => {
    vi.useFakeTimers();
    const messages: Array<{ message: string; payload?: unknown }> = [];
    const diagnostics = createDiagnostics('warn', (_level, message, payload) => {
      messages.push({ message, payload });
    });
    const raw = hostWithSilentCallbackSlots();
    const wx = { createImage: () => raw } as unknown as WxLike;
    const image = createImageFactory(wx, diagnostics).createImage();
    const listener = vi.fn();
    image.addEventListener('error', listener);

    image.src = 'textures/normal.png';
    vi.advanceTimersByTime(2000);

    expect(listener).toHaveBeenCalledTimes(1);
    const related = messages.filter((entry) => entry.message.includes('image-events-timeout'));
    expect(related).toHaveLength(1);
    expect(related[0]!.payload).toMatchObject({ path: 'onload', src: 'textures/normal.png' });
  });

  it('loads on a host with a silent addEventListener shell and a native data-property src', () => {
    const host = hostWithNativeDataSrc();
    const wx = { createImage: () => host.raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const listener = vi.fn();
    image.addEventListener('load', listener);

    image.src = 'textures/normal.png';

    // The write reached the host's interceptor, and the adapter never
    // replaced the property — that replacement is what stopped the native
    // load on the real device (width/height stayed 0).
    expect(host.srcWrites()).toEqual(['textures/normal.png']);
    expect(host.srcDefineCount()).toBe(0);

    // The shell addEventListener never dispatches; the wired slots deliver.
    host.emit('load');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'load' }));
    expect(image.complete).toBe(true);
  });

  it('arms the fallback via the src poll and names both wired channels on timeout', () => {
    vi.useFakeTimers();
    const host = hostWithNativeDataSrc();
    const wx = { createImage: () => host.raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const listener = vi.fn();
    image.addEventListener('error', listener);

    image.src = 'textures/normal.png';
    expect(listener).not.toHaveBeenCalled();

    // 100 ms poll tick to detect the write, then the 2 s watchdog.
    vi.advanceTimersByTime(2100);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toMatchObject({
      type: 'error',
      detail: { reason: 'image-events-timeout', path: 'addEventListener+onload' },
    });
    expect(image.complete).toBe(true);
  });

  it('settles once when both the native listener channel and the slot channel fire', () => {
    const host = hostWithNativeEventTarget();
    const wx = { createImage: () => host.raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const listener = vi.fn();
    image.addEventListener('load', listener);

    image.src = 'textures/normal.png';
    host.emit('load'); // channel 1: the host's native addEventListener
    const slot = (host.raw as { onload?: unknown }).onload; // channel 2: the slot the adapter wired
    if (typeof slot === 'function') (slot as (event?: unknown) => void)({ type: 'load' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(image.complete).toBe(true);
  });

  it('still reaches the getImageInfo fallback on a data-property host via the poll', () => {
    vi.useFakeTimers();
    const raw = hostWithoutEventPath(true);
    const getImageInfo = vi.fn((options: { src: string; success?: (info: { width: number; height: number }) => void }) => {
      options.success?.({ width: 64, height: 32 });
    });
    const wx = { createImage: () => raw, getImageInfo } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const onerror = vi.fn();
    image.addEventListener('error', onerror);

    image.src = 'textures/normal.png';
    vi.advanceTimersByTime(100);

    expect(getImageInfo).toHaveBeenCalledWith(expect.objectContaining({ src: 'textures/normal.png' }));
    expect(onerror).toHaveBeenCalledTimes(1);
    expect(image.complete).toBe(true);
  });

  it('loads object URLs on a native data-property host because they are data: URIs', () => {
    const host = hostWithNativeDataSrc();
    const wx = { createImage: () => host.raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();
    const listener = vi.fn();
    image.addEventListener('load', listener);

    const uri = MiniURL.createObjectURL(
      new MiniBlob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
    );
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);

    image.src = uri;

    // Pass-through: the host receives the URI itself — no accessor, no
    // rewrite, nothing for the adapter to resolve later.
    expect(host.srcWrites()).toEqual([uri]);
    expect(host.srcDefineCount()).toBe(0);

    host.emit('load');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(image.complete).toBe(true);
  });
});
