import { describe, expect, it, vi } from 'vitest';
import { detectCapabilities } from '../src/core/capabilities';
import { createDiagnostics } from '../src/core/diagnostics';
import { probeContext } from '../src/platforms/wechat-common';
import type { WxCanvas } from '../src/platforms/wx-types';

function fakeCanvas(supported: readonly string[]): WxCanvas {
  return {
    width: 1,
    height: 1,
    getContext: (type: string) => (supported.includes(type) ? { getExtension: () => null } : null),
  } as WxCanvas;
}

function sink(): { messages: string[]; diagnostics: ReturnType<typeof createDiagnostics> } {
  const messages: string[] = [];
  const diagnostics = createDiagnostics('warn', (level, message) => {
    if (level === 'warn') messages.push(message);
  });
  return { messages, diagnostics };
}

describe('probeContext', () => {
  it('prefers the offscreen canvas and never creates the on-screen one', () => {
    const createCanvas = vi.fn();
    const wx = {
      createOffscreenCanvas: () => fakeCanvas(['webgl2']),
      createCanvas,
    };
    expect(probeContext(wx as never, 'webgl2', { allowCanvasFallback: true })).toBe(true);
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it('falls back to a second createCanvas() when offscreen is unavailable', () => {
    const wx = { createCanvas: () => fakeCanvas(['webgl2', 'webgl']) };
    expect(probeContext(wx as never, 'webgl2', { allowCanvasFallback: true })).toBe(true);
  });

  it('reports true from the real canvas even when offscreen cannot do WebGL2', () => {
    let calls = 0;
    const wx = {
      createOffscreenCanvas: () => { calls++; return fakeCanvas([]); },
      createCanvas: () => fakeCanvas(['webgl2']),
    };
    expect(probeContext(wx as never, 'webgl2', { allowCanvasFallback: true })).toBe(true);
    expect(calls).toBe(1);
  });

  it('returns undefined (unknown, not false) when it cannot probe at all', () => {
    expect(probeContext({} as never, 'webgl2', { allowCanvasFallback: true })).toBeUndefined();
    expect(probeContext({ createCanvas: () => fakeCanvas([]) } as never, 'webgl2')).toBeUndefined();
  });
});

describe('detectCapabilities', () => {
  it('treats an inconclusive probe as unknown and falls back to the version heuristic', () => {
    const { messages, diagnostics } = sink();
    const caps = detectCapabilities(
      { SDKVersion: '3.18.0' } as never,
      'wechat-game',
      { probeContext: () => undefined, diagnostics },
    );
    expect(caps.webgl2).toBe(true);
    expect(caps.webgl2Source).toBe('inferred');
    expect(messages.join('\n')).toContain('WebGL2 could not be probed');
  });

  it('keeps a real negative probe negative', () => {
    const { messages, diagnostics } = sink();
    const caps = detectCapabilities(
      { SDKVersion: '3.18.0' } as never,
      'wechat-game',
      { probeContext: () => false, diagnostics },
    );
    expect(caps.webgl2).toBe(false);
    expect(caps.webgl2Source).toBe('probe');
    expect(messages).toHaveLength(0);
  });

  it('marks explicit overrides and lets them win over probing', () => {
    const caps = detectCapabilities(
      { SDKVersion: '2.1.0' } as never,
      'wechat-game',
      { overrides: { webgl2: true }, probeContext: () => false },
    );
    expect(caps.webgl2).toBe(true);
    expect(caps.webgl2Source).toBe('override');
  });
});
