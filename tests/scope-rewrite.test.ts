import { describe, expect, it } from 'vitest';
import { rewriteGlobals, DEFAULT_GLOBAL_NAMES } from '../src/build/scope-rewrite';

function rewrite(code: string): string {
  const result = rewriteGlobals(code, 'virtual-test.js');
  if (result && 'error' in result) throw new Error(result.error);
  return result?.code ?? code;
}

describe('rewriteGlobals', () => {
  it('rewrites free browser globals and injects the scope import', () => {
    const out = rewrite('const w = window.innerWidth; const d = document.createElement("canvas");');
    expect(out).toContain("import { getActiveScope as __m3 } from 'mini-three-adapter/scope';");
    expect(out).toContain('__m3().window.innerWidth');
    expect(out).toContain('__m3().document.createElement');
  });

  it('does NOT rewrite locally shadowed identifiers', () => {
    const out = rewrite(`
      function f(window) { return window.innerWidth; }
      const document = { createElement: () => 1 };
      export const a = document.createElement('canvas');
      export const b = URL.createObjectURL(new Blob([]));
    `);
    expect(out).toContain('return window.innerWidth;');
    expect(out).toContain("document.createElement('canvas');");
    expect(out).toContain('__m3().URL.createObjectURL');
    expect(out).toContain('__m3().Blob');
  });

  it('does NOT rewrite object keys or member properties', () => {
    const out = rewrite(`
      const o = { window: 1, Image: 2, document: 3 };
      foo.window = 1;
      export const x = window.innerWidth;
    `);
    expect(out).toContain('{ window: 1, Image: 2, document: 3 }');
    expect(out).toContain('foo.window = 1;');
    expect(out).toContain('__m3().window.innerWidth');
  });

  it('keeps typeof feature detection valid', () => {
    const out = rewrite("if (typeof window !== 'undefined') { console.log('browser'); }");
    expect(out).toContain("typeof __m3().window !== 'undefined'");
  });

  it('does not rewrite imports, exports or declarations', () => {
    const out = rewrite("import { window as w } from 'x'; const Image = 1; export { Image };\nwindow.setTimeout(() => {}, 0);");
    expect(out).toContain("import { window as w } from 'x'");
    expect(out).toContain('const Image = 1;');
    expect(out).toContain('export { Image };');
    expect(out).toContain('__m3().window.setTimeout');
    expect(out).not.toContain('__m3().Image');
  });

  it('returns null when no target globals exist', () => {
    expect(rewriteGlobals('export const a = 1 + 2;', 'x.js')).toBeNull();
  });

  it('supports custom accessor and extra globals', () => {
    const result = rewriteGlobals('export const x = myGlobal.foo;', 'x.js', {
      accessor: '__scope',
      extraGlobals: ['myGlobal'],
      globals: [],
    });
    expect(result && 'code' in result && result.code).toContain('__scope().myGlobal.foo');
  });

  it('exposes the default global list', () => {
    expect(DEFAULT_GLOBAL_NAMES).toContain('window');
    expect(DEFAULT_GLOBAL_NAMES).toContain('createImageBitmap');
    expect(DEFAULT_GLOBAL_NAMES).not.toContain('globalThis');
  });
});

/** Drop the injected import so the output can be fed to the Function constructor. */
function parsable(code: string): void {
  const body = rewrite(code).replace(/^import .*\n/, '');
  expect(() => new Function(body)).not.toThrow(SyntaxError);
}

describe('new expression callee (BUG-1)', () => {
  it('parenthesises the class so it is still constructed', () => {
    expect(rewrite('const d = new TextDecoder();')).toContain('new (__m3().TextDecoder)()');
    expect(rewrite('const c = new AbortController();')).toContain('new (__m3().AbortController)()');
  });

  it('wraps only the root of a member chain', () => {
    expect(rewrite("new window.Event('tap')")).toContain("new (__m3().window).Event('tap')");
    expect(rewrite("new window.window.Event('x')")).toContain("new (__m3().window).window.Event('x')");
  });

  it('keeps `new X().method()` semantics', () => {
    const out = rewrite("new OffscreenCanvas(1, 1).getContext('2d')");
    expect(out).toContain("new (__m3().OffscreenCanvas)(1, 1).getContext('2d')");
    expect(() => new Function(out.replace(/^import .*\n/, ''))).not.toThrow(SyntaxError);
  });

  it('does not disturb non-constructing uses', () => {
    expect(rewrite('class A extends TextDecoder {}')).toContain('extends __m3().TextDecoder');
    expect(rewrite('TextDecoder.length')).toContain('__m3().TextDecoder.length');
  });
});

describe('shorthand object properties (BUG-2)', () => {
  it('expands into an explicit key/value pair', () => {
    expect(rewrite('const o = { TextDecoder };')).toContain('{ TextDecoder: (__m3().TextDecoder) }');
    expect(rewrite('const o = { window };')).toContain('{ window: (__m3().window) }');
  });

  it('leaves the expansion parseable', () => {
    parsable('const o = { window, document, fetch };');
  });

  it('does not rewrite non-shorthand keys or destructuring patterns', () => {
    expect(rewriteGlobals('const o = { TextDecoder: 1 };', 'x.js')).toBeNull();
    expect(rewriteGlobals('const { TextDecoder } = obj;', 'x.js')).toBeNull();
  });
});

describe('typeof guard (BUG-5)', () => {
  it('turns a pre-runtime typeof into "undefined" instead of throwing', () => {
    const out = rewrite("if (typeof document !== 'undefined') { init(); }");
    expect(out).toContain('typeof (__m3Has() ? __m3().document : undefined)');
    expect(out).toContain('hasActiveScope as __m3Has');
  });

  it('needs no guard for window/self/globalThis', () => {
    const out = rewrite("if (typeof window !== 'undefined') { tick(); }");
    expect(out).toContain('typeof __m3().window');
    expect(out).not.toContain('__m3Has');
  });

  it('keeps the import line unchanged when no guard is emitted', () => {
    const out = rewrite('export const x = window.innerWidth;');
    expect(out.startsWith("import { getActiveScope as __m3 } from 'mini-three-adapter/scope';")).toBe(true);
  });

  it('stays parseable', () => {
    parsable('if (typeof document === "undefined") {}');
  });
});
