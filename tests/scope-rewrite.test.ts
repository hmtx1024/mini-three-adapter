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
