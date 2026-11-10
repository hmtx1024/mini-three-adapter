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

export const SCOPE_IMPORT = (
  accessor: string,
  module: string,
  extraSpecifiers: readonly string[] = [],
): string => {
  const specifiers = [`getActiveScope as ${accessor}`, ...extraSpecifiers].join(', ');
  return `import { ${specifiers} } from '${module}';\n`;
};

/**
 * Reference or range equality. `@babel/parser` emits TWO distinct `Identifier`
 * nodes with identical `[start, end]` for a shorthand property (`{ X }`: one for
 * `key`, one for `value`), so reference equality alone is not enough to tell
 * "this identifier is an object key".
 */
function sameNode(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const x = a as { start?: number | null; end?: number | null } | null | undefined;
  const y = b as { start?: number | null; end?: number | null } | null | undefined;
  return Boolean(x && y && x.start != null && x.start === y.start && x.end === y.end);
}

function isNonComputedKey(path: NodePath): boolean {
  const parent = path.parentPath;
  if (!parent) return false;
  const self: unknown = path.node;
  if (parent.isObjectProperty() && !parent.node.computed && sameNode(parent.node.key, self)) return true;
  if (parent.isObjectMethod() && !parent.node.computed && sameNode(parent.node.key, self)) return true;
  if (parent.isClassProperty() && !parent.node.computed && sameNode(parent.node.key, self)) return true;
  if (parent.isClassMethod() && !parent.node.computed && sameNode(parent.node.key, self)) return true;
  if (parent.isMemberExpression() && !parent.node.computed && sameNode(parent.node.property, self)) return true;
  return false;
}

/**
 * `{ X }`: the value node shares its range with the key, so it cannot be
 * rewritten in place — it must be expanded to `{ X: <expr> }`.
 */
function isShorthandValue(path: NodePath): boolean {
  const parent = path.parentPath;
  if (!parent?.isObjectProperty()) return false;
  if (!parent.node.shorthand || parent.node.computed) return false;
  if (parent.node.value !== path.node) return false;
  // `const { X } = obj` destructures a binding, never a global reference. Babel
  // already treats it as a binding, this guard keeps the two paths disjoint.
  return !parent.parentPath?.isObjectPattern();
}

/**
 * Is this identifier the left-most link of a `new X` / `new X.Y.Z` callee chain?
 *
 * `new f().g()` parses as `(new f()).g()`, so rewriting `X` to a *call*
 * (`__m3().X`) without parentheses silently turns `new X()` into
 * `(new __m3()).X()` — the scope object gets constructed and the class is then
 * invoked as a plain function. Wrapping only the chain root is enough:
 * `new (a().b).c` parses as `new ((a().b).c)`.
 */
function isNewCalleeRoot(path: NodePath): boolean {
  let cur: NodePath = path;
  let parent = cur.parentPath;
  while (parent?.isMemberExpression() && parent.node.object === cur.node) {
    cur = parent;
    parent = parent.parentPath;
  }
  return Boolean(parent?.isNewExpression() && parent.node.callee === cur.node);
}

/** `typeof X` must never throw: `typeof a.b` is legal even when `a` is unbound. */
function isDirectTypeofOperand(path: NodePath): boolean {
  const parent = path.parentPath;
  return Boolean(
    parent?.isUnaryExpression() &&
      parent.node.operator === 'typeof' &&
      parent.node.argument === path.node,
  );
}

/**
 * Globals that `getActiveScope()` resolves to itself even before a runtime
 * exists, so `typeof window` is already `'object'` and needs no guard.
 */
const ALWAYS_OBJECT_GLOBALS: ReadonlySet<string> = new Set(['window', 'self', 'globalThis']);

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
  const hasAccessor = `${accessor}Has`;
  let count = 0;
  let needsHasGuard = false;

  traverse(ast, {
    ReferencedIdentifier(path: NodePath<Node>) {
      const node = path.node as Identifier;
      const name = node.name;
      if (!name || !names.has(name)) return;
      if (node.start == null || node.end == null) return;
      // Babel scope knows about imports, function params, local declarations,
      // catch bindings and block-scoped shadowing. This is the critical check
      // that a regex-based replacement cannot perform.
      if (path.scope.hasBinding(name, true)) return;

      const ref = `${accessor}().${name}`;

      // 1) Shorthand must be handled before the key check: once `isNonComputedKey`
      //    compares ranges, `{ X }`'s value looks like a key too and would be
      //    silently skipped (leaving an undefined global behind).
      if (isShorthandValue(path)) {
        seen.add(name);
        ms.overwrite(node.start, node.end, `${name}: (${ref})`);
        count++;
        return;
      }

      // 2) Object keys / member property names are not references.
      if (isNonComputedKey(path)) return;

      seen.add(name);
      if (isDirectTypeofOperand(path) && !ALWAYS_OBJECT_GLOBALS.has(name)) {
        // `typeof X` must never throw. The placeholder scope answers the
        // environment globals (document/navigator/screen/...) with `undefined`
        // already, but everything else — TextDecoder, HTMLCanvasElement,
        // Blob, ... — throws an actionable error on access, and a `typeof`
        // probe must not become that error.
        ms.overwrite(node.start, node.end, `(${hasAccessor}() ? ${ref} : undefined)`);
        needsHasGuard = true;
        count++;
        return;
      }
      ms.overwrite(node.start, node.end, isNewCalleeRoot(path) ? `(${ref})` : ref);
      count++;
    },
  });

  if (count === 0) return null;
  ms.prepend(SCOPE_IMPORT(
    accessor,
    scopeModule,
    needsHasGuard ? [`hasActiveScope as ${hasAccessor}`] : [],
  ));
  return {
    code: ms.toString(),
    map: ms.generateMap({ source: id, includeContent: true, hires: true }) as unknown as { toString(): string },
    count,
    seen: Array.from(seen).sort(),
  };
}
