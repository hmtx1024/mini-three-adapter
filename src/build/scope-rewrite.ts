/**
 * AST-based global-to-scope rewriting.
 *
 * The reference adapter uses a Rollup "prefix global" pass that effectively
 * text-replaces identifiers. That breaks on shadowed locals, object keys, and
 * `typeof window` feature detection. Here we parse with @babel/parser and use
 * Babel's scope binding information, so ONLY free (unbound) references to
 * browser globals are rewritten — application code is never touched.
 */
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import MagicString from 'magic-string';
import type { NodePath } from '@babel/traverse';
import type { Identifier } from '@babel/types';
import type { Node } from '@babel/types';

// Babel's CJS/ESM interop differs between bundlers; normalize once.
const traverse = (typeof _traverse === 'function'
  ? _traverse
  : (_traverse as unknown as { default: typeof _traverse }).default) as typeof _traverse;

export const DEFAULT_GLOBAL_NAMES: readonly string[] = [
  'window', 'self', 'document', 'navigator', 'screen', 'location',
  'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
  'devicePixelRatio', 'pageXOffset', 'pageYOffset',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame',
  'getComputedStyle', 'matchMedia', 'atob', 'btoa',
  'Event', 'EventTarget', 'CustomEvent', 'PointerEvent', 'MouseEvent',
  'TouchEvent', 'MessageEvent', 'ProgressEvent', 'KeyboardEvent', 'DOMException',
  'HTMLElement', 'HTMLCanvasElement', 'HTMLImageElement', 'HTMLVideoElement',
  'OffscreenCanvas', 'Image', 'ImageData', 'DOMRect',
  'WebGLRenderingContext', 'WebGL2RenderingContext', 'AudioContext',
  'Blob', 'URL', 'URLSearchParams', 'FileReader', 'TextDecoder', 'TextEncoder',
  'AbortController', 'AbortSignal', 'fetch', 'XMLHttpRequest', 'WebSocket',
  'createImageBitmap', 'Worker', 'WebAssembly', 'ResizeObserver',
];

/** Globals that must remain `undefined` in the mini game scope. */
export const DEFAULT_FORCE_UNDEF: readonly string[] = ['createImageBitmap'];

export interface RewriteOptions {
  /** Extra global identifiers to rewrite. */
  extraGlobals?: string[];
  /** Replace the default global list instead of extending it. */
  globals?: string[];
  /** Identifiers that must evaluate to `undefined` (feature-detection off). */
  forceUndef?: string[];
  /** Name of the injected scope accessor. Default `__m3`. */
  accessor?: string;
  /** Module specifier that exports `getActiveScope`. */
  scopeModule?: string;
}

export interface RewriteResult {
  code: string;
  map: { toString(): string } | null;
  /** Number of rewritten references. */
  count: number;
  /** Globals actually seen (useful for the build report). */
  seen: string[];
}

export interface RewriteFailure {
  code: string;
  error: string;
}

export const SCOPE_IMPORT = (accessor: string, module: string): string =>
  `import { getActiveScope as ${accessor} } from '${module}';\n`;

function isNonComputedKey(path: NodePath): boolean {
  const parent = path.parentPath;
  if (!parent) return false;
  const self: unknown = path.node;
  if (parent.isObjectProperty() && !parent.node.computed && (parent.node.key as unknown) === self) return true;
  if (parent.isObjectMethod() && !parent.node.computed && (parent.node.key as unknown) === self) return true;
  if (parent.isClassProperty() && !parent.node.computed && (parent.node.key as unknown) === self) return true;
  if (parent.isClassMethod() && !parent.node.computed && (parent.node.key as unknown) === self) return true;
  if (parent.isMemberExpression() && !parent.node.computed && (parent.node.property as unknown) === self) return true;
  return false;
}

/** Rewrite free browser-global references in one module. Returns null if nothing changed. */
export function rewriteGlobals(
  code: string,
  id: string,
  options: RewriteOptions = {},
): RewriteResult | RewriteFailure | null {
  const names = new Set<string>([
    ...(options.globals ?? DEFAULT_GLOBAL_NAMES),
    ...(options.extraGlobals ?? []),
    ...(options.forceUndef ?? DEFAULT_FORCE_UNDEF),
  ]);
  const accessor = options.accessor ?? '__m3';
  const scopeModule = options.scopeModule ?? 'mini-three-adapter/scope';

  let ast;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      plugins: ['importAttributes', 'classProperties', 'topLevelAwait', 'typescript', 'jsx'],
    });
  } catch (error) {
    return { code, error: `[mini-three] parse failed for ${id}: ${String(error)}` };
  }

  const ms = new MagicString(code);
  const seen = new Set<string>();
  let count = 0;

  traverse(ast, {
    ReferencedIdentifier(path: NodePath<Node>) {
      const node = path.node as Identifier;
      const name = node.name;
      if (!name || !names.has(name)) return;
      if (node.start == null || node.end == null) return;
      if (isNonComputedKey(path)) return;
      // Babel scope knows about imports, function params, local declarations,
      // catch bindings and block-scoped shadowing. This is the critical check
      // that a regex-based replacement cannot perform.
      if (path.scope.hasBinding(name, true)) return;
      // `typeof window` stays correct: `typeof __m3().window` === 'object'.
      seen.add(name);
      ms.overwrite(node.start, node.end, `${accessor}().${name}`);
      count++;
    },
  });

  if (count === 0) return null;
  ms.prepend(SCOPE_IMPORT(accessor, scopeModule));
  return {
    code: ms.toString(),
    map: ms.generateMap({ source: id, includeContent: true, hires: true }) as unknown as { toString(): string },
    count,
    seen: Array.from(seen).sort(),
  };
}
