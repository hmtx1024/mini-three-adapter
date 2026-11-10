import { describe, expect, it, vi } from 'vitest';
import { detectCapabilities } from '../src/core/capabilities';
import { createDiagnostics } from '../src/core/diagnostics';
import { probeContext } from '../src/platforms/wechat-common';
import { createWeChatGameBinding, resetScreenCanvasCache } from '../src/platforms/wechat-game';
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

  it('refuses to touch the on-screen canvas when createCanvas() hands it back', () => {
    // 微信首次 createCanvas() 返回上屏画布。若宿主从 GameGlobal.screencanvas
    // 拿到画布（没消耗这次"首次"），回退探测就会摸到它——一次 getContext +
    // loseContext 就能把上屏画布废掉，症状是黑屏且不报错。
    const getContext = vi.fn(() => ({ getExtension: () => ({ loseContext: vi.fn() }) }));
    const screen = { width: 1, height: 1, getContext } as unknown as WxCanvas;
    const wx = { createCanvas: () => screen };
    const result = probeContext(wx as never, 'webgl2', {
      allowCanvasFallback: true,
      screenCanvas: screen,
    });
    expect(result).toBeUndefined();
    expect(getContext).not.toHaveBeenCalled();
  });

  it('still uses createCanvas() when it returns a different canvas', () => {
    const screen = fakeCanvas(['webgl2']);
    const wx = { createCanvas: () => fakeCanvas(['webgl2']) };
    expect(probeContext(wx as never, 'webgl2', {
      allowCanvasFallback: true,
      screenCanvas: screen,
    })).toBe(true);
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

describe('wechat-game binding probe safety', () => {
  it('leaves a seeded GameGlobal.screencanvas untouched', () => {
    const host = globalThis as unknown as { GameGlobal?: { screencanvas?: unknown } };
    const getContext = vi.fn(() => ({ getExtension: () => ({ loseContext: vi.fn() }) }));
    const screen = { width: 375, height: 667, getContext } as unknown as WxCanvas;

    host.GameGlobal = { screencanvas: screen };
    resetScreenCanvasCache();
    try {
      const binding = createWeChatGameBinding({
        // 模拟"首次 createCanvas 仍返回上屏画布"的宿主
        wx: { SDKVersion: '3.18.0', createCanvas: () => screen } as never,
        diagnostics: createDiagnostics('silent'),
      });
      expect(binding.rawCanvas).toBe(screen);
      // 探测不出结论，退回版本推断；绝不对上屏画布 getContext
      expect(binding.capabilities.webgl2Source).toBe('inferred');
      expect(getContext).not.toHaveBeenCalled();
    } finally {
      delete host.GameGlobal;
      resetScreenCanvasCache();
    }
  });
});
