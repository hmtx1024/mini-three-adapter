import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageFactory } from '../src/core/image';
import { createDiagnostics } from '../src/core/diagnostics';
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

  it('writes src through a plain data property instead of swallowing it', () => {
    const raw = hostWithoutEventPath(true);
    const wx = { createImage: () => raw } as unknown as WxLike;
    const image = createImageFactory(wx).createImage();

    image.src = 'textures/a.png';
    expect(raw.src).toBe('textures/a.png');

    // The wrapper must survive the one-off restore so later writes still work.
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
      addEventListener: 'missing',
      getImageInfo: 'missing',
    });
  });
});
