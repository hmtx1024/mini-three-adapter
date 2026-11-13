/** DOM-ish container objects (document / screen / DOMRect / OffscreenCanvas ctor). */
import type { DocumentLike, ElementLike, MiniThreeScope } from '../scope';
import type { Rect } from '../types';
import { MiniDOMException, MiniEventTarget, patchEventTarget } from '../polyfills/event';
import {
  DOMRectShim,
  HTMLElementShim,
  OffscreenCanvasShim,
  patchElement,
} from './element';
import { patchCanvas } from './canvas';
import type { PlatformBinding } from './platform';
import type { Diagnostics } from './diagnostics';
import type { ContextType } from '../types';

export class ShimDOMRect implements Rect {
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    DOMRectShim.__instances.add(this);
  }
  get top(): number { return this.y; }
  get left(): number { return this.x; }
  get right(): number { return this.x + this.width; }
  get bottom(): number { return this.y + this.height; }
  toJSON(): Record<string, number> {
    return { x: this.x, y: this.y, width: this.width, height: this.height, top: this.top, left: this.left, right: this.right, bottom: this.bottom };
  }
  static fromRect(other?: Partial<Rect>): ShimDOMRect {
    return new ShimDOMRect(other?.left ?? 0, other?.top ?? 0, other?.width ?? 0, other?.height ?? 0);
  }
}

function createBody(document: DocumentLike): ElementLike {
  const body = {} as ElementLike;
  patchElement(body, {
    rect: { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 },
    document,
    instanceOf: [HTMLElementShim],
    extra: {
      tagName: { value: 'BODY' },
      appendChild: { value: (child: unknown) => child, writable: true },
      removeChild: { value: (child: unknown) => child, writable: true },
      insertBefore: { value: (child: unknown) => child, writable: true },
      contains: { value: () => false, writable: true },
    },
  });
  return body;
}

export interface CreateDocumentOptions {
  binding: PlatformBinding;
  diagnostics: Diagnostics;
  defaultContextType: ContextType;
  /** Objects registered here get `instanceof HTMLCanvasElement` etc. */
  documentRef: { current: DocumentLike | null };
}

/** Build the fake `document` used by three.js and its addons. */
export function createDocument(options: CreateDocumentOptions): DocumentLike {
  const { binding, diagnostics, defaultContextType } = options;
  const document = new MiniEventTarget() as unknown as DocumentLike;
  const body = createBody(document);
  document.body = body;
  document.documentElement = body;
  document.defaultView = null;

  const createCanvas = (width?: number, height?: number, type: ContextType = defaultContextType): HTMLCanvasElement => {
    const raw = binding.createOffscreenCanvas(width ?? 1, height ?? 1, type);
    const patched = patchCanvas(raw, {
      rect: { width: raw.width, height: raw.height, left: 0, top: 0, right: raw.width, bottom: raw.height },
      document,
      diagnostics,
      normalizeWebGL: true,
      nativeEventTarget: binding.nativeEventTarget === true,
    });
    OffscreenCanvasShim.__instances.add(raw as object);
    return patched.canvas;
  };

  const createElement = (tagName: string): unknown => {
    const tag = String(tagName).toLowerCase();
    if (tag === 'canvas') {
      // three.js creates a canvas when WebGLRenderer is constructed without one.
      // Prefer webgl2 (three >= r163 requires it); fall back to 2d with a clear
      // warning instead of silently producing a broken renderer.
      try {
        return createCanvas(1, 1, 'webgl2');
      } catch (error) {
        diagnostics.warn('createElement("canvas"): webgl2 offscreen canvas failed, falling back to 2d', error);
        return createCanvas(1, 1, '2d');
      }
    }
    if (tag === 'img' || tag === 'image') return binding.imageFactory.createImage();
    if (tag === 'div' || tag === 'span' || tag === 'a') {
      const el = {} as ElementLike;
      patchElement(el, {
        rect: { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 },
        document,
        instanceOf: [HTMLElementShim],
      });
      return el;
    }
    diagnostics.warnOnce(`createElement-${tag}`, `document.createElement("${tag}") is not emulated; returning a generic element`);
    const el = {} as ElementLike;
    patchElement(el, {
      rect: { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 },
      document,
    });
    return el;
  };

  Object.defineProperties(document, {
    createElement: { value: createElement, writable: true, configurable: true },
    createElementNS: {
      value: (_ns: string | null, tagName: string) => createElement(tagName),
      writable: true,
      configurable: true,
    },
    createTextNode: { value: (text: string) => ({ textContent: text }), configurable: true },
    getElementById: { value: () => null, configurable: true },
    querySelector: { value: () => null, configurable: true },
    querySelectorAll: { value: () => [], configurable: true },
    hidden: { value: false, writable: true, configurable: true },
    visibilityState: { value: 'visible', writable: true, configurable: true },
    readyState: { value: 'complete', writable: true, configurable: true },
    nodeType: { value: 9, writable: true, configurable: true },
  });
  options.documentRef.current = document;
  return document;
}

/** Build the fake `screen` object. */
export function createScreen(width: number, height: number): MiniThreeScope['screen'] {
  const screen = {
    width,
    height,
    availWidth: width,
    availHeight: height,
    colorDepth: 24,
    pixelDepth: 24,
    orientation: { type: 'portrait-primary', angle: 0 },
  } as unknown as MiniThreeScope['screen'];
  patchEventTarget(screen);
  return screen;
}

/** Constructor shims that three.js may `new` or use with `instanceof`. */
export function createOffscreenCanvasCtor(binding: PlatformBinding): unknown {
  const Ctor = function (this: unknown, width = 1, height = 1): HTMLCanvasElement {
    const raw = binding.createOffscreenCanvas(width, height, '2d');
    const patched = patchCanvas(raw, {
      rect: { width, height, left: 0, top: 0, right: width, bottom: height },
      normalizeWebGL: true,
      nativeEventTarget: binding.nativeEventTarget === true,
    });
    OffscreenCanvasShim.__instances.add(raw as object);
    return patched.canvas;
  } as unknown as { new (w?: number, h?: number): HTMLCanvasElement };
  Object.defineProperty(Ctor, 'name', { value: 'OffscreenCanvas' });
  Object.defineProperty(Ctor, Symbol.hasInstance, {
    value: (instance: unknown) => OffscreenCanvasShim.__instances.has(instance as object),
  });
  return Ctor;
}

export { MiniDOMException };
