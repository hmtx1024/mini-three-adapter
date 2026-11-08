/**
 * In-place DOM-ish patching.
 *
 * WeChat stores canvas/image validation metadata in an internal WeakMap keyed by
 * object identity. Wrapping in a `new`-ed class or a `Proxy` breaks those checks.
 * So we **define properties on the original object** and use
 * `Symbol.hasInstance` + a registry to make `instanceof HTMLCanvasElement` pass.
 *
 * Improvement over the reference adapter: we do NOT mutate the object's
 * prototype (`Object.setPrototypeOf`), which is a de-optimisation in JSC/V8 and
 * can break other libraries that also patch prototypes.
 */
import type { CanvasStyleLike, Disposer, Rect } from '../types';
import { patchEventTarget } from '../polyfills/event';

const registries = new WeakMap<object, WeakSet<object>>();

export interface MockClass<T extends object = object> {
  new (...args: never[]): T;
  readonly __instances: WeakSet<object>;
}

/**
 * Create a constructor whose `instanceof` checks consult a registry. The
 * constructor itself throws (it must never be used to create real objects).
 */
export function createMockClass<T extends object = object>(name: string): MockClass<T> {
  const instances = new WeakSet<object>();
  const Ctor = function (this: unknown): never {
    throw new TypeError(`[mini-three-adapter] ${name} is an interface shim, use the platform factory instead`);
  } as unknown as MockClass<T>;
  Object.defineProperty(Ctor, 'name', { value: name });
  Object.defineProperty(Ctor, Symbol.hasInstance, {
    value: (instance: unknown) =>
      (typeof instance === 'object' || typeof instance === 'function') &&
      instance !== null &&
      instances.has(instance as object),
  });
  Object.defineProperty(Ctor, '__instances', { value: instances });
  registries.set(Ctor as unknown as object, instances);
  return Ctor;
}

export function markAs<T extends object>(ctor: MockClass<T>, instance: object): void {
  ctor.__instances.add(instance);
}

export function isMarked<T extends object>(ctor: MockClass<T>, instance: unknown): boolean {
  return (typeof instance === 'object' || typeof instance === 'function') &&
    instance !== null && ctor.__instances.has(instance as object);
}

/** Shared mock constructors. Registered globally so all platforms agree. */
export const HTMLCanvasElementShim = createMockClass<HTMLCanvasElement>('HTMLCanvasElement');
export const HTMLImageElementShim = createMockClass<HTMLImageElement>('HTMLImageElement');
export const HTMLElementShim = createMockClass<HTMLElement>('HTMLElement');
export const OffscreenCanvasShim = createMockClass<OffscreenCanvas>('OffscreenCanvas');
export const ImageDataShim = createMockClass<ImageData>('ImageData');
export const WebGLRenderingContextShim = createMockClass<WebGLRenderingContext>('WebGLRenderingContext');
export const WebGL2RenderingContextShim = createMockClass<WebGL2RenderingContext>('WebGL2RenderingContext');
export const DOMRectShim = createMockClass<DOMRect>('DOMRect');

export interface PatchedElement<T extends object> {
  element: T;
  updateRect(rect: Rect): void;
  disposers: Disposer[];
}

export interface PatchElementOptions<T extends object> {
  rect: Rect;
  document?: unknown;
  /** Extra property descriptors merged onto the object. */
  extra?: PropertyDescriptorMap;
  /** Mark the object as an instance of these shims. */
  instanceOf?: Array<{ __instances: WeakSet<object> }>;
  /** Called on `setAttribute(name, value)`. */
  onSetAttribute?: (name: string, value: unknown, element: T) => void;
}

function define(target: object, key: string, descriptor: PropertyDescriptor): void {
  Object.defineProperty(target, key, {
    enumerable: false,
    configurable: true,
    ...descriptor,
  });
}

/** Patch DOM-ish properties onto an existing object while keeping identity. */
export function patchElement<T extends object>(
  instance: T,
  options: PatchElementOptions<T>,
): PatchedElement<T> {
  if (!instance || (typeof instance !== 'object' && typeof instance !== 'function')) {
    throw new TypeError('[mini-three-adapter] patchElement expects an object');
  }
  let rect: Rect = { ...options.rect };

  const style = {} as CanvasStyleLike;
  define(style, 'width', { get: () => `${rect.width}px`, set: (v: string) => {
    const n = Number.parseFloat(String(v));
    if (!Number.isNaN(n) && String(v).endsWith('px')) rect = { ...rect, width: n };
  } });
  define(style, 'height', { get: () => `${rect.height}px`, set: (v: string) => {
    const n = Number.parseFloat(String(v));
    if (!Number.isNaN(n) && String(v).endsWith('px')) rect = { ...rect, height: n };
  } });
  let display = 'block';
  define(style, 'display', { get: () => display, set: (v: string) => { display = String(v); } });
  style.cursor = 'default';
  style.touchAction = 'none';

  define(instance, 'style', { value: style, writable: true });
  define(instance, 'clientTop', { get: () => 0 });
  define(instance, 'clientLeft', { get: () => 0 });
  define(instance, 'clientWidth', { get: () => rect.width });
  define(instance, 'clientHeight', { get: () => rect.height });
  define(instance, 'offsetTop', { get: () => rect.top });
  define(instance, 'offsetLeft', { get: () => rect.left });
  define(instance, 'offsetWidth', { get: () => rect.width });
  define(instance, 'offsetHeight', { get: () => rect.height });
  define(instance, 'getBoundingClientRect', { value: () => ({ ...rect }), writable: true });
  define(instance, 'setAttribute', { value: (name: string, value: unknown) => {
    options.onSetAttribute?.(name, value, instance);
  }, writable: true });
  define(instance, 'removeAttribute', { value: () => undefined, writable: true });
  define(instance, 'ownerDocument', { value: options.document ?? null, writable: true });
  define(instance, 'getRootNode', { value: () => options.document ?? instance, writable: true });
  define(instance, 'setPointerCapture', { value: () => undefined, writable: true });
  define(instance, 'releasePointerCapture', { value: () => undefined, writable: true });
  define(instance, 'hasPointerCapture', { value: () => false, writable: true });
  define(instance, 'requestPointerLock', { value: () => undefined, writable: true });
  define(instance, 'exitPointerLock', { value: () => undefined, writable: true });
  define(instance, 'focus', { value: () => undefined, writable: true });
  define(instance, 'blur', { value: () => undefined, writable: true });
  define(instance, 'scrollTop', { get: () => 0, set: () => undefined });
  define(instance, 'scrollLeft', { get: () => 0, set: () => undefined });

  patchEventTarget(instance);

  if (options.extra) {
    for (const [key, descriptor] of Object.entries(options.extra)) {
      define(instance, key, descriptor);
    }
  }
  for (const ctor of options.instanceOf ?? []) {
    ctor.__instances.add(instance as object);
  }

  return {
    element: instance,
    updateRect(next: Rect) {
      rect = { ...next };
    },
    disposers: [],
  };
}

export function normalizeRect(partial: Partial<Rect> = {}): Rect {
  const width = partial.width ?? 0;
  const height = partial.height ?? 0;
  const left = partial.left ?? 0;
  const top = partial.top ?? 0;
  return {
    width,
    height,
    left,
    top,
    right: partial.right ?? left + width,
    bottom: partial.bottom ?? top + height,
  };
}
