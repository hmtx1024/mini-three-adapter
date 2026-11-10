import { afterEach, describe, expect, it } from 'vitest';
import { clearEarlyScopeReads, getActiveScope, getEarlyScopeReads } from '../src/scope';
import { createWeChatGameRuntime, resetScreenCanvasCache } from '../src/platforms/wechat-game';
import type { MiniThreeRuntime } from '../src/core/runtime';
import { createMockWx } from './helpers/mock-wx';

let runtime: MiniThreeRuntime | null = null;

function sink(): string[] {
  const messages: string[] = [];
  return messages;
}

function collect(messages: string[]) {
  return (level: string, message: string) => {
    messages.push(`${level}: ${message}`);
  };
}

afterEach(() => {
  runtime?.dispose();
  runtime = null;
  resetScreenCanvasCache();
  clearEarlyScopeReads();
});

/**
 * 未创建 runtime 时 `getActiveScope()` 返回占位对象。这个占位对象有两个互相
 * 拉扯的目标：`typeof` 类特性检测必须永不抛错（`typeof a.b` 在 JS 里是会抛的），
 * 而真实使用又应当立刻拿到可读报错。这里把两条边界都钉住。
 */
describe('placeholder scope before a runtime exists', () => {
  it('reads environment globals as undefined instead of throwing', () => {
    const scope = getActiveScope();
    expect(scope.document).toBeUndefined();
    expect(scope.navigator).toBeUndefined();
    expect(scope.screen).toBeUndefined();
    // typeof 不会抛，且看到的是「没有 DOM 的宿主」
    expect(typeof (scope as { document: unknown }).document).toBe('undefined');
  });

  it('survives a nested `typeof window.document` probe', () => {
    // 这是构建期无法守卫的形态：`typeof` 的操作数是成员表达式，插件只把
    // `window` 换成了 `__m3()`，取不到 `document` 时仍会抛。
    const scope = getActiveScope();
    expect(typeof (scope.window as { document: unknown }).document).toBe('undefined');
    expect(() => String(scope.window.navigator)).not.toThrow();
  });

  it('still throws for a real API access, with an actionable message', () => {
    expect(() => getActiveScope().HTMLCanvasElement).toThrow(/was read before a runtime was created/);
    expect(() => getActiveScope().TextDecoder).toThrow(/createWeChatGameRuntime\(\)/);
  });

  it('records early reads so the runtime can point at them', async () => {
    void getActiveScope().document;
    expect(getEarlyScopeReads()).toEqual(['document']);

    const messages = sink();
    runtime = await createWeChatGameRuntime({ wx: createMockWx(), reporter: collect(messages) });

    const text = messages.join('\n');
    expect(text).toContain('before this runtime existed');
    expect(text).toContain('document');
    // 报过一次就清空，避免每次创建 runtime 重复告警
    expect(getEarlyScopeReads()).toEqual([]);
  });

  it('records a nested early read as well', async () => {
    void getActiveScope().window.screen;
    expect(getEarlyScopeReads()).toEqual(['screen']);

    const messages = sink();
    runtime = await createWeChatGameRuntime({ wx: createMockWx(), reporter: collect(messages) });
    expect(messages.join('\n')).toContain('screen');
  });

  it('stays quiet when nothing was read early', async () => {
    const messages = sink();
    runtime = await createWeChatGameRuntime({ wx: createMockWx(), reporter: collect(messages) });
    expect(messages.join('\n')).not.toContain('before this runtime existed');
  });
});
