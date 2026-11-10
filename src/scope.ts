/**
 * Scoped globals: the central design decision of mini-three-adapter.
 *
 * The original adapter style (and WeChat's official `weapp-adapter`) writes
 * `window`, `document`, `Image`, ... onto `globalThis`. That is convenient but
 * irreversible: it breaks H5 dual-target builds, makes two three.js versions
 * fight over the same canvas, and cannot be un-installed in tests.
 *
 * Here the shims live in one explicit `MiniThreeScope` object. Third-party
 * modules (three, three/addons, three-stdlib, ...) are rewritten at build time
 * by `mini-three-adapter/vite` so that their *free* references to browser
 * globals resolve through `getActiveScope()`. Application code is untouched.
 *
 * `installGlobals()` remains available as an explicit, reversible escape hatch
 * for libraries that cannot be transformed.
 */
import type {
  CanvasStyleLike,
  EventTargetLike,
  PatchedCanvas,
  Rect,
} from './types';

export interface DocumentLike extends EventTargetLike {
  createElement(tagName: string): PatchedCanvas | unknown;
  createElementNS(namespaceURI: string | null, tagName: string): PatchedCanvas | unknown;
  body: ElementLike;
  documentElement: ElementLike;
  defaultView: MiniThreeScope | null;
  [key: string]: unknown;
}

export interface ElementLike extends EventTargetLike {
  style: CanvasStyleLike;
  clientWidth: number;
  clientHeight: number;
  getBoundingClientRect(): Rect;
  setAttribute(name: string, value: unknown): void;
  removeAttribute(name: string): void;
  [key: string]: unknown;
}

export interface NavigatorLike {
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  [key: string]: unknown;
}

/**
 * The set of browser globals three.js (and its addons) may read. Members are
 * typed where they matter and `unknown` in the index signature so the build
 * plugin can add platform-specific extras without loosening the whole object.
 */
export interface MiniThreeScope extends EventTargetLike {
  readonly window: MiniThreeScope;
  readonly self: MiniThreeScope;
  readonly globalThis: MiniThreeScope;
  document: DocumentLike;
  navigator: NavigatorLike;
  screen: EventTargetLike & {
    width: number;
    height: number;
    availWidth: number;
    availHeight: number;
    colorDepth: number;
    pixelDepth: number;
  };
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  devicePixelRatio: number;
  pageXOffset: number;
  pageYOffset: number;
  performance: { now(): number };
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(id: number): void;
  getComputedStyle(element: unknown): CanvasStyleLike;
  matchMedia(query: string): { matches: boolean; media: string; addListener(l: unknown): void; removeListener(l: unknown): void };
  atob(data: string): string;
  btoa(data: string): string;

  Event: unknown;
  EventTarget: unknown;
  CustomEvent: unknown;
  PointerEvent: unknown;
  MouseEvent: unknown;
  TouchEvent: unknown;
  MessageEvent: unknown;
  ProgressEvent: unknown;
  KeyboardEvent: unknown;
  DOMException: unknown;

  HTMLElement: unknown;
  HTMLCanvasElement: unknown;
  HTMLImageElement: unknown;
  HTMLVideoElement: unknown;
  OffscreenCanvas: unknown;
  Image: unknown;
  ImageData: unknown;
  DOMRect: unknown;
  WebGLRenderingContext: unknown;
  WebGL2RenderingContext: unknown;
  AudioContext: unknown;

  Blob: unknown;
  URL: unknown;
  FileReader: unknown;
  TextDecoder: unknown;
  TextEncoder: unknown;
  AbortController: unknown;
  AbortSignal: unknown;
  fetch: unknown;
  XMLHttpRequest: unknown;
  WebSocket: unknown;
  createImageBitmap: unknown;
  Worker: unknown;
  WebAssembly: unknown;
  ResizeObserver: unknown;

  [key: string]: unknown;
}

let active: MiniThreeScope | null = null;

function notInitialized(name: string): never {
  throw new Error(
    `[mini-three-adapter] Scoped global "${name}" was read before a runtime was created. ` +
      `Import 'mini-three-adapter/wechat-game' and await createWeChatGameRuntime() before importing three.js, ` +
      `or call installGlobals(scope) explicitly.`,
  );
}

/**
 * Globals that describe *whether a DOM exists* rather than a concrete API.
 *
 * Feature detection reads them with `typeof` or truthiness — `typeof document`,
 * `typeof window.document`, `if (navigator.userAgent)`. `typeof x.y` is NOT a
 * safe operator in JavaScript: it throws as soon as the getter throws, and the
 * build plugin can only guard a *direct* `typeof X` operand, not a member
 * chain. Throwing here therefore turns "is this a browser?" into a crash inside
 * the adapter, which is the one place a library cannot afford it.
 *
 * So before a runtime exists these keys read as `undefined` — exactly what a
 * non-DOM host looks like — and the early read is recorded so `createRuntime()`
 * can still point at the real cause. Every other key keeps throwing: touching
 * `HTMLCanvasElement` or `TextDecoder` is a real use, not a probe, and a silent
 * `undefined` would surface three frames later in an unrelated place.
 */
const UNDEFINED_BEFORE_RUNTIME: ReadonlySet<string> = new Set([
  'document',
  'navigator',
  'screen',
  'location',
  'history',
]);

const earlyReads = new Set<string>();

/**
 * Names read from the placeholder scope before any runtime existed. Reported
 * once by `createRuntime()`: it means some module was evaluated too early.
 */
export function getEarlyScopeReads(): readonly string[] {
  return Array.from(earlyReads);
}

/** Clear the recorded early reads (called by `createRuntime()` after reporting). */
export function clearEarlyScopeReads(): void {
  earlyReads.clear();
}

/**
 * A stable placeholder returned when no runtime exists yet. `typeof scope.window`
 * still yields "object" (which is what three.js feature-detection expects), the
 * environment globals read as `undefined`, and any other access throws an
 * actionable error instead of silently returning `undefined` three frames later.
 */
const emptyScope: MiniThreeScope = new Proxy(
  { window: null, self: null, globalThis: null } as unknown as MiniThreeScope,
  {
    get(target, prop) {
      if (prop === 'window' || prop === 'self' || prop === 'globalThis') return emptyScope;
      if (prop === Symbol.toStringTag) return 'MiniThreeScope';
      if (typeof prop === 'string' && UNDEFINED_BEFORE_RUNTIME.has(prop)) {
        earlyReads.add(prop);
        return undefined;
      }
      // Protocol hooks (Symbol.iterator, util.inspect.custom, ...) must not
      // explode while someone is merely logging the placeholder.
      if (typeof prop === 'symbol') return undefined;
      return notInitialized(prop);
    },
    has() {
      return false;
    },
  },
);

/** Returns the currently installed scope (or the throwing placeholder). */
export function getActiveScope(): MiniThreeScope {
  return active ?? emptyScope;
}

/** Install / replace the active scope. Returns a disposer. */
export function setActiveScope(scope: MiniThreeScope | null): () => void {
  const previous = active;
  active = scope;
  return () => {
    if (active === scope) active = previous;
  };
}

export function hasActiveScope(): boolean {
  return active !== null;
}

/**
 * Build a scope with a set of overrides. `window`, `self` and `globalThis`
 * are wired to the scope itself so that `window.window === window`.
 */
export function createScope(overrides: Partial<MiniThreeScope> = {}): MiniThreeScope {
  const scope = {
    ...overrides,
  } as MiniThreeScope;
  Object.defineProperties(scope, {
    window: { get: () => scope, enumerable: true, configurable: true },
    self: { get: () => scope, enumerable: true, configurable: true },
    globalThis: { get: () => scope, enumerable: true, configurable: true },
  });
  return scope;
}

/** Keys written by `installGlobals`. Kept explicit so restoration is exact. */
const GLOBAL_KEYS = [
  'window', 'self', 'document', 'navigator', 'screen',
  'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio',
  'pageXOffset', 'pageYOffset', 'performance',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'matchMedia',
  'atob', 'btoa',
  'Event', 'EventTarget', 'CustomEvent', 'PointerEvent', 'MouseEvent', 'TouchEvent',
  'MessageEvent', 'ProgressEvent', 'KeyboardEvent', 'DOMException',
  'HTMLElement', 'HTMLCanvasElement', 'HTMLImageElement', 'HTMLVideoElement',
  'OffscreenCanvas', 'Image', 'ImageData', 'DOMRect',
  'WebGLRenderingContext', 'WebGL2RenderingContext', 'AudioContext',
  'Blob', 'URL', 'FileReader', 'TextDecoder', 'TextEncoder',
  'AbortController', 'AbortSignal', 'fetch', 'XMLHttpRequest', 'WebSocket',
  'createImageBitmap', 'Worker', 'WebAssembly', 'ResizeObserver',
] as const;

export interface InstallGlobalsOptions {
  /** Defaults to `globalThis`. */
  target?: Record<string, unknown>;
  /** Skip keys that already exist (useful in a browser / H5 build). */
  skipExisting?: boolean;
  /** Additional keys to copy from the scope. */
  extraKeys?: string[];
}

/**
 * Explicit opt-in global pollution for libraries that cannot be transformed.
 * Returns a disposer that restores every overwritten descriptor exactly.
 *
 * This is intentionally NOT called automatically: the default path is scoped.
 */
export function installGlobals(
  scope: MiniThreeScope,
  options: InstallGlobalsOptions = {},
): () => void {
  const target = options.target ?? (globalThis as unknown as Record<string, unknown>);
  const keys: string[] = [...GLOBAL_KEYS, ...(options.extraKeys ?? [])];
  const saved = new Map<string, PropertyDescriptor | undefined>();

  for (const key of keys) {
    const existing = Object.getOwnPropertyDescriptor(target, key);
    if (options.skipExisting && existing) continue;
    if (!(key in scope)) continue;
    saved.set(key, existing);
    Object.defineProperty(target, key, {
      get: () => (scope as Record<string, unknown>)[key],
      configurable: true,
      enumerable: true,
    });
  }

  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete target[key];
    }
  };
}
