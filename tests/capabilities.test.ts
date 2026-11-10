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

  it('does not fall back at all when the offscreen API is missing', () => {
    // 没有 createOffscreenCanvas 时无法判断「首次 createCanvas()」是否已被消耗，
    // 兜底等于掷硬币，而输的那一面是上屏上下文被销毁（ADR-0008）。
    const createCanvas = vi.fn(() => fakeCanvas(['webgl2', 'webgl']));
    const wx = { createCanvas };
    expect(probeContext(wx as never, 'webgl2', { allowCanvasFallback: true })).toBeUndefined();
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it('reports true from the real canvas when offscreen cannot do WebGL2', () => {
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
    const wx = {
      createOffscreenCanvas: () => fakeCanvas([]),
      createCanvas: () => screen,
    };
    const result = probeContext(wx as never, 'webgl2', {
      allowCanvasFallback: true,
      reservedCanvases: [screen],
    });
    expect(result).toBeUndefined();
    expect(getContext).not.toHaveBeenCalled();
  });

  it('still uses createCanvas() when it returns a canvas nobody reserved', () => {
    const screen = fakeCanvas(['webgl2']);
    const wx = {
      createOffscreenCanvas: () => fakeCanvas([]),
      createCanvas: () => fakeCanvas(['webgl2']),
    };
    expect(probeContext(wx as never, 'webgl2', {
      allowCanvasFallback: true,
      reservedCanvases: [screen],
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

  it('leaves the seeded canvas untouched even when the host passes its own canvas', () => {
    // §10.2b：宿主既预置了 `GameGlobal.screencanvas`，又显式传了另一个画布。
    // `getScreenCanvas` 走 supplied 分支、不写缓存，比对基准若只取"本次使用的
    // 画布"就对不上 `GameGlobal.screencanvas`，探测会把它废掉。
    const host = globalThis as unknown as { GameGlobal?: { screencanvas?: unknown } };
    const events: string[] = [];
    const screenGetContext = vi.fn((type: string) => {
      events.push(`screen.getContext(${type})`);
      return { getExtension: () => ({ loseContext: () => events.push('screen.loseContext()') }) };
    });
    const screen = { width: 375, height: 667, getContext: screenGetContext } as unknown as WxCanvas;
    const supplied = fakeCanvas(['webgl2']);

    host.GameGlobal = { screencanvas: screen };
    resetScreenCanvasCache();
    try {
      const binding = createWeChatGameBinding({
        canvas: supplied,
        // 没有 createOffscreenCanvas：兜底直接放弃
        wx: { SDKVersion: '3.18.0', createCanvas: () => screen } as never,
        diagnostics: createDiagnostics('silent'),
      });
      expect(binding.rawCanvas).toBe(supplied);
      expect(screenGetContext).not.toHaveBeenCalled();
      expect(events.filter((e) => e.startsWith('screen.'))).toEqual([]);
      expect(binding.capabilities.webgl2Source).toBe('inferred');
    } finally {
      delete host.GameGlobal;
      resetScreenCanvasCache();
    }
  });

  it('refuses a seeded canvas handed back by createCanvas() when offscreen exists', () => {
    // 离屏画布存在但答不出 WebGL2 时仍会回退；此时回退拿到的若正是被预置的
    // 上屏画布，身份比对必须命中——基准是"所有候选"，不是"本次使用的画布"。
    const host = globalThis as unknown as { GameGlobal?: { screencanvas?: unknown } };
    const screenGetContext = vi.fn(() => ({ getExtension: () => ({ loseContext: vi.fn() }) }));
    const screen = { width: 375, height: 667, getContext: screenGetContext } as unknown as WxCanvas;

    host.GameGlobal = { screencanvas: screen };
    resetScreenCanvasCache();
    try {
      const binding = createWeChatGameBinding({
        canvas: fakeCanvas(['webgl2']),
        wx: {
          SDKVersion: '3.18.0',
          createOffscreenCanvas: () => fakeCanvas([]),
          createCanvas: () => screen,
        } as never,
        diagnostics: createDiagnostics('silent'),
      });
      expect(binding.capabilities.webgl2Source).toBe('inferred');
      expect(screenGetContext).not.toHaveBeenCalled();
    } finally {
      delete host.GameGlobal;
      resetScreenCanvasCache();
    }
  });
});
