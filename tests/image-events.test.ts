import { describe, expect, it, vi } from 'vitest';
import { createImageFactory } from '../src/core/image';
import { createDiagnostics } from '../src/core/diagnostics';
import { createMockWx } from './helpers/mock-wx';
import type { WxLike } from '../src/platforms/wx-types';

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

  it('warns once (not per image) when the host has no writable callback slot', () => {
    const warnings: string[] = [];
    const diagnostics = createDiagnostics('warn', (level, message) => {
      if (level === 'warn') warnings.push(message);
    });
    const raw: Record<string, unknown> = { width: 0, height: 0, src: '' };
    Object.defineProperty(raw, 'onload', { value: null, writable: false, configurable: false });
    Object.defineProperty(raw, 'onerror', { value: null, writable: false, configurable: false });
    const wx = { createImage: () => raw } as unknown as WxLike;
    const factory = createImageFactory(wx, diagnostics);

    expect(() => factory.createImage()).not.toThrow();
    expect(() => factory.createImage()).not.toThrow();

    const related = warnings.filter((m) => m.includes('onload/onerror'));
    expect(related).toHaveLength(1);
    expect(related[0]).toContain('never fire');
  });
});
