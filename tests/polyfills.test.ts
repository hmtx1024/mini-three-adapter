import { describe, expect, it } from 'vitest';
import {
  MiniEvent,
  MiniEventTarget,
  MiniPointerEvent,
  patchEventTarget,
} from '../src/polyfills/event';
import { MiniBlob, MiniURL, bytesToBase64, base64ToBytes, resolveUrl } from '../src/polyfills/blob-url';
import { atob, btoa, MiniTextEncoder, MiniTextDecoder } from '../src/polyfills/text-encoding';
import { MiniAbortController, createFetch } from '../src/polyfills/network';

describe('event system', () => {
  it('supports add/remove/dispatch and once', () => {
    const target = new MiniEventTarget();
    const calls: string[] = [];
    const once = (): void => { calls.push('once'); };
    const always = (): void => { calls.push('always'); };
    target.addEventListener('tick', once, { once: true });
    target.addEventListener('tick', always);
    target.dispatchEvent(new MiniEvent('tick'));
    target.dispatchEvent(new MiniEvent('tick'));
    expect(calls).toEqual(['once', 'always', 'always']);
    target.removeEventListener('tick', always);
    target.dispatchEvent(new MiniEvent('tick'));
    expect(calls).toHaveLength(3);
    target.dispatchEvent(new MiniEvent('tick'));
    expect(calls).toHaveLength(3);
  });

  it('patches EventTarget onto an existing object without changing identity', () => {
    const raw = { id: 7 };
    const patched = patchEventTarget(raw);
    expect(patched).toBe(raw);
    let seen = 0;
    patched.addEventListener('x', () => { seen++; });
    patched.dispatchEvent(new MiniEvent('x'));
    expect(seen).toBe(1);
  });

  it('PointerEvent carries coordinates and buttons', () => {
    const ev = new MiniPointerEvent('pointerdown', { pointerId: 3, clientX: 12, clientY: 34, buttons: 1 });
    expect(ev.pointerId).toBe(3);
    expect(ev.clientX).toBe(12);
    expect(ev.buttons).toBe(1);
    expect(ev.pointerType).toBe('touch');
  });
});

describe('blob + url', () => {
  it('round-trips base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('creates and revokes data-backed object URLs', () => {
    const blob = new MiniBlob(['hello'], { type: 'text/plain' });
    const url = MiniURL.createObjectURL(blob);
    expect(MiniURL.resolveObjectURL(url)).toBe('data:text/plain;base64,aGVsbG8=');
    MiniURL.revokeObjectURL(url);
    expect(MiniURL.resolveObjectURL(url)).toBeNull();
  });

  it('resolves relative URLs', () => {
    expect(resolveUrl('b.glb', 'https://cdn.example.com/models/a.glb')).toBe('https://cdn.example.com/models/b.glb');
    expect(resolveUrl('../tex.png', 'https://cdn.example.com/models/a.glb')).toBe('https://cdn.example.com/tex.png');
    expect(resolveUrl('data:image/png;base64,AA', 'https://x.com/')).toBe('data:image/png;base64,AA');
  });

  it('parses URL parts', () => {
    const u = new MiniURL('https://x.com:8080/a/b?c=1#frag');
    expect(u.hostname).toBe('x.com');
    expect(u.port).toBe('8080');
    expect(u.pathname).toBe('/a/b');
    expect(u.searchParams.get('c')).toBe('1');
  });
});

describe('text encoding', () => {
  it('atob / btoa round-trip', () => {
    expect(atob(btoa('hello'))).toBe('hello');
  });

  it('TextEncoder / TextDecoder handle CJK', () => {
    const encoded = new MiniTextEncoder().encode('小游戏 three.js 🚀');
    expect(new MiniTextDecoder().decode(encoded)).toBe('小游戏 three.js 🚀');
  });
});

describe('network', () => {
  it('fetch returns an ArrayBuffer-backed response', async () => {
    const wx = {
      request: (options: { success?: (r: unknown) => void }): object => {
        options.success?.({ statusCode: 200, data: new Uint8Array([1, 2, 3]).buffer, header: {} });
        return {};
      },
    };
    const response = await createFetch(wx as never)('https://example.com/a.bin');
    expect(response.ok).toBe(true);
    expect((await response.arrayBuffer()).byteLength).toBe(3);
  });

  it('AbortController dispatches once', () => {
    const controller = new MiniAbortController();
    let count = 0;
    controller.signal.addEventListener('abort', () => { count++; });
    controller.abort();
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
    expect(count).toBe(1);
  });
});
