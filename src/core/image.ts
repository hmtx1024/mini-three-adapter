/** Image / ImageData / HTMLImageElement shims built on wx.createImage. */
import type { WxImage, WxLike } from '../platforms/wx-types';
import { MiniURL } from '../polyfills/blob-url';
import { MiniCustomEvent } from '../polyfills/event';
import {
  HTMLImageElementShim,
  HTMLElementShim,
  ImageDataShim,
  patchElement,
  type MockClass,
} from './element';
import type { Diagnostics } from './diagnostics';

export interface MiniImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  colorSpace: string;
}

export class ShimImageData implements MiniImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  colorSpace = 'srgb';
  constructor(widthOrData: number | Uint8ClampedArray, heightOrWidth?: number, height?: number) {
    if (typeof widthOrData === 'number') {
      this.width = widthOrData;
      this.height = heightOrWidth ?? widthOrData;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = widthOrData;
      this.width = heightOrWidth ?? 0;
      this.height = height ?? (this.width ? this.data.length / (this.width * 4) : 0);
    }
    ImageDataShim.__instances.add(this);
  }
}

function findDescriptor(target: object, key: string): PropertyDescriptor | undefined {
  let node: object | null = target;
  while (node) {
    const d = Object.getOwnPropertyDescriptor(node, key);
    if (d) return d;
    node = Object.getPrototypeOf(node) as object | null;
  }
  return undefined;
}

function resolveSrc(src: string): string {
  if (typeof src !== 'string') return src;
  const resolved = MiniURL.resolveObjectURL(src);
  return resolved ?? src;
}

/** Bound method lookup that never throws (host objects can be exotic). */
function callable(target: object, key: string): ((...args: unknown[]) => unknown) | undefined {
  let value: unknown;
  try {
    value = (target as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
  if (typeof value !== 'function') return undefined;
  try {
    return (value as (...args: unknown[]) => unknown).bind(target);
  } catch {
    return undefined;
  }
}

function ownPropertyNames(target: object): string[] {
  try {
    return Object.getOwnPropertyNames(target).slice(0, 16);
  } catch {
    return [];
  }
}

/** Classify a host callback slot for the diagnostics payload. */
function describeSlot(descriptor: PropertyDescriptor | undefined): string {
  if (!descriptor) return 'missing';
  if (typeof descriptor.set === 'function') return 'accessor';
  return descriptor.writable ? 'data' : 'data-readonly';
}

/**
 * How long to wait before turning a bridge that cannot possibly settle into an
 * observable `error`. Only armed when the host offers no event path at all, so
 * it can never interrupt a slow-but-working load.
 */
const EVENT_WATCHDOG_MS = 2000;

export interface ImageFactory {
  /** `new Image()` returns a wx image object patched with DOM-ish behaviour. */
  Image: new (width?: number, height?: number) => HTMLImageElement;
  HTMLImageElement: MockClass<HTMLImageElement>;
  ImageData: new (
    dataOrWidth: number | Uint8ClampedArray,
    widthOrHeight?: number,
    height?: number,
  ) => MiniImageData;
  createImage(): HTMLImageElement;
  createImageData(width: number, height: number): MiniImageData;
  /** Always undefined on WeChat: Blob is unavailable, so three.js must take its
   *  non-createImageBitmap branch. The build plugin can force this to `void 0`. */
  createImageBitmap: undefined;
}

export function createImageFactory(wx: WxLike, diagnostics?: Diagnostics): ImageFactory {
  const createRaw = (): WxImage => {
    if (typeof wx.createImage === 'function') return wx.createImage();
    if (typeof wx.createOffscreenCanvas === 'function') {
      const off = wx.createOffscreenCanvas({ width: 1, height: 1, type: '2d' });
      if (typeof off.createImage === 'function') return off.createImage();
    }
    throw new Error(
      '[mini-three-adapter] Neither wx.createImage nor OffscreenCanvas.createImage is available. ' +
        'Upgrade the WeChat base library or inject an `imageFactory` in options.',
    );
  };

  const make = (width?: number, height?: number): HTMLImageElement => {
    const raw = createRaw();
    if (width != null) raw.width = width;
    if (height != null) raw.height = height;

    // Capture EVERY native registration entry point before `patchElement` (and
    // the shim accessors further down) shadow them.
    //
    // Relying on `getOwnPropertyDescriptor` alone was the 0.1.4 defect: a host
    // that keeps the callback in a native slot answers `undefined` here, yet
    // still accepts `img.onload = fn` and fires it. The bridge then had no entry
    // point at all and every texture waited for the application's own timeout.
    const nativeLoad = findDescriptor(raw, 'onload');
    const nativeError = findDescriptor(raw, 'onerror');
    const nativeComplete = findDescriptor(raw, 'complete');
    const nativeAdd = callable(raw, 'addEventListener');

    // Snapshot of the host shape, taken before anything of ours can mask it, so
    // a bug report shows what the device actually exposes.
    const hostShape = {
      onload: describeSlot(nativeLoad),
      onerror: describeSlot(nativeError),
      addEventListener: nativeAdd ? 'native' : 'missing',
      complete: nativeComplete ? 'native' : 'missing',
      getImageInfo: typeof wx.getImageInfo === 'function' ? 'available' : 'missing',
      ownNames: ownPropertyNames(raw),
    };

    HTMLImageElementShim.__instances.add(raw);
    HTMLElementShim.__instances.add(raw);
    patchElement(raw, {
      rect: { width: raw.width || 0, height: raw.height || 0, left: 0, top: 0, right: raw.width || 0, bottom: raw.height || 0 },
      extra: {
        tagName: { value: 'IMG' },
        nodeName: { value: 'IMG' },
        nodeType: { value: 1 },
      },
    });

    // Wrap `src` so mini-three-blob: object URLs become data: URIs.
    const srcDescriptor = findDescriptor(raw, 'src');
    let currentSrc = '';
    /** Wired once the bridge exists: a host without an event path only learns
     *  that it needs the fallback when a `src` finally arrives. */
    let onSrcChange: ((src: string) => void) | undefined;

    /**
     * Hand the value to the host. A descriptor with a setter is the normal case;
     * a plain writable data property has to be restored for exactly one write,
     * otherwise our own accessor swallows it and the host never starts loading.
     */
    const writeNativeSrc = (next: string): void => {
      if (srcDescriptor?.set) {
        srcDescriptor.set.call(raw, next);
        return;
      }
      if (srcDescriptor && srcDescriptor.writable === true) {
        try {
          Object.defineProperty(raw, 'src', srcDescriptor);
          raw.src = next;
        } finally {
          installSrcAccessor();
        }
        return;
      }
      diagnostics?.warnOnce(
        'image-no-src-setter',
        'wx image exposes no writable src; the host will never start loading and textures will fail',
        { src: next },
      );
    };

    const installSrcAccessor = (): void => {
      try {
        Object.defineProperty(raw, 'src', {
          configurable: true,
          enumerable: true,
          get: () => (srcDescriptor?.get ? srcDescriptor.get.call(raw) : currentSrc),
          set: (value: string) => {
            const next = resolveSrc(String(value));
            currentSrc = next;
            writeNativeSrc(next);
            onSrcChange?.(next);
          },
        });
      } catch {
        /* non-configurable host property: keep the native one */
      }
    };
    installSrcAccessor();

    /**
     * Event flow (the direction matters):
     *
     *   native wx load  ->  forward()  ->  dispatch(MiniEvent)  ->  listeners
     *                                                            \-> inline `onload`
     *
     * `dispatchEvent` already invokes the inline `on<type>` handler, so the
     * forwarder must NOT call the user handler itself or every callback fires
     * twice (and re-dispatching from inside an inline handler would recurse).
     */
    const handlers: Record<'load' | 'error', ((event?: unknown) => void) | undefined> = {
      load: undefined,
      error: undefined,
    };
    /** `load` seen. three's `TextureLoader` treats it as "texture is usable". */
    let settled = false;
    /** `error` seen. Browser semantics: `complete` becomes true on failure too. */
    let failed = false;
    let terminalDetail: unknown;
    const decodeWaiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
    let watchdogId: ReturnType<typeof setTimeout> | undefined;

    const dispatch = (event: unknown): void => {
      (raw as unknown as { dispatchEvent(e: unknown): void }).dispatchEvent(event);
    };

    /**
     * The single terminal transition. Both outcomes settle `complete` and wake
     * `decode()`; a second native event (some hosts fire `load` and then
     * `error`) is dropped so listeners observe exactly one result.
     */
    const finish = (eventName: 'load' | 'error', detail?: unknown): void => {
      if (settled || failed) return;
      terminalDetail = detail;
      if (eventName === 'load') settled = true;
      else failed = true;
      if (watchdogId !== undefined) {
        clearTimeout(watchdogId);
        watchdogId = undefined;
      }
      for (const waiter of decodeWaiters.splice(0)) {
        if (eventName === 'load') waiter.resolve();
        else waiter.reject(detail);
      }
      dispatch(new MiniCustomEvent(eventName, { detail }));
    };

    const forwardLoad = (nativeEvent?: unknown): void => { finish('load', nativeEvent); };
    const forwardError = (nativeEvent?: unknown): void => { finish('error', nativeEvent); };

    /** Which native path actually carries events on this host. */
    let eventPath: 'addEventListener' | 'onload' | 'getImageInfo' | 'watchdog' | undefined;

    // Tier 1: the host's own `addEventListener`. Captured before `patchElement`,
    // otherwise this call would land in our shim and no native event would ever
    // reach the forwarder.
    if (nativeAdd) {
      try {
        nativeAdd('load', forwardLoad);
        nativeAdd('error', forwardError);
        eventPath = 'addEventListener';
      } catch {
        /* fall through to the next shape */
      }
    }

    // Tier 2: plain assignment into the native callback slot. Must happen BEFORE
    // the user-facing accessors below: after those exist the assignment only
    // writes `handlers` and the host never hears about it.
    if (!eventPath) {
      try {
        raw.onload = forwardLoad;
        raw.onerror = forwardError;
        // A non-writable slot swallows the assignment silently in sloppy mode.
        if (typeof raw.onload === 'function') eventPath = 'onload';
      } catch {
        /* frozen slot */
      }
    }

    if (!eventPath) {
      diagnostics?.warnOnce(
        'image-native-events',
        'image exposes neither onload/onerror slots nor a native addEventListener; ' +
          'load/error will come from a fallback (wx.getImageInfo or a watchdog)',
        hostShape,
      );
    }

    // User-facing accessors only REGISTER a callback; delivery happens above.
    // A host that freezes `onload` cannot be intercepted at all — the warning
    // above already covers that case, so never throw out of createImage().
    for (const eventName of ['load', 'error'] as const) {
      try {
        Object.defineProperty(raw, `on${eventName}`, {
          configurable: true,
          enumerable: true,
          get: () => handlers[eventName],
          set: (next: ((event?: unknown) => void) | null) => {
            handlers[eventName] = typeof next === 'function' ? next : undefined;
          },
        });
      } catch {
        /* non-configurable host property: keep the native one */
      }
    }

    /**
     * Read the host's own `complete` through the descriptor captured at creation
     * time. Reading `raw.complete` here would hit our accessor and recurse.
     */
    const hostComplete = (): boolean => {
      if (!nativeComplete) return false;
      try {
        if (typeof nativeComplete.get === 'function') return Boolean(nativeComplete.get.call(raw));
        return Boolean(nativeComplete.value);
      } catch {
        return false;
      }
    };
    try {
      Object.defineProperty(raw, 'complete', {
        configurable: true,
        enumerable: true,
        get: () => settled || failed || hostComplete(),
      });
    } catch {
      /* non-configurable host property: keep the native one */
    }

    /**
     * Last resort when the host offers no event path at all. `wx.getImageInfo`
     * decodes the file through a separate API, so it can tell "asset is fine,
     * this object just never reports" from "asset is missing / undecodable"
     * (e.g. WebP on devices without a WebP decoder). It does NOT put pixels into
     * the image object, so synthesising a `load` would hand three an empty
     * texture; report a fast, diagnosable `error` instead of a silent hang.
     */
    const getImageInfo = typeof wx.getImageInfo === 'function' ? wx.getImageInfo.bind(wx) : undefined;
    let fallbackStarted = false;

    /**
     * Armed as soon as a `src` arrives, whatever the host shape looks like.
     *
     * "The callback slot accepted our function" is not proof the host will ever
     * call it: some hosts store the assignment and stay silent forever, which is
     * indistinguishable from a working load until the clock runs out. So the
     * watchdog is unconditional; `finish()` clears it on either outcome, and a
     * genuine `load`/`error` always wins because `finish()` is terminal-once.
     */
    const armWatchdog = (): void => {
      if (watchdogId !== undefined) return;
      watchdogId = setTimeout(() => {
        watchdogId = undefined;
        // A host that reports `complete` has decoded the image even if it never
        // reported it: browser semantics say `load` already happened.
        if (hostComplete()) {
          finish('load', { type: 'load', reason: 'watchdog-complete' });
          return;
        }
        forwardError({ type: 'error', reason: 'image-events-timeout', path: eventPath });
      }, EVENT_WATCHDOG_MS);
    };

    const startFallback = (src: string): void => {
      if (settled || failed || !src) return;
      // Unconditional: a wired slot is not a delivered event (see armWatchdog).
      armWatchdog();
      if (eventPath || fallbackStarted) return;
      fallbackStarted = true;

      if (getImageInfo) {
        eventPath = 'getImageInfo';
        try {
          getImageInfo({
            src,
            success: (info) => {
              diagnostics?.warnOnce(
                'image-events-unavailable',
                `image "${src}" is reachable (${info.width}x${info.height}) but this host delivers no image ` +
                  'events; the texture is reported as failed instead of uploading an empty image',
                hostShape,
              );
              forwardError({
                type: 'error',
                reason: 'image-events-unavailable',
                width: info.width,
                height: info.height,
              });
            },
            fail: (error) => {
              diagnostics?.warnOnce(
                'image-getImageInfo-failed',
                `wx.getImageInfo could not read "${src}"; check the path, the format (WebP is not ` +
                  'decodable on every device) and whether the file is inside the package',
                { errMsg: error?.errMsg, host: hostShape },
              );
              forwardError({ type: 'error', reason: 'getImageInfo-failed', error });
            },
          });
        } catch (error) {
          forwardError({ type: 'error', reason: 'getImageInfo-threw', error });
        }
        return;
      }

      // No event path and no metadata API: the verdict comes from the watchdog.
      eventPath = 'watchdog';
    };
    onSrcChange = startFallback;

    Object.defineProperty(raw, 'crossOrigin', { value: '', writable: true, configurable: true });
    Object.defineProperty(raw, 'decode', {
      value: () => new Promise<void>((resolve, reject) => {
        // Failure first: `complete` is true for a failed image as well, so the
        // browser check must not short-circuit into a resolve.
        if (failed) return reject(terminalDetail);
        if (settled || hostComplete()) return resolve();
        decodeWaiters.push({ resolve, reject });
      }),
      configurable: true,
    });
    return raw as unknown as HTMLImageElement;
  };

  const ImageCtor = function (this: unknown, width?: number, height?: number) {
    return make(width, height);
  } as unknown as new (width?: number, height?: number) => HTMLImageElement;
  Object.defineProperty(ImageCtor, 'name', { value: 'Image' });

  return {
    Image: ImageCtor,
    HTMLImageElement: HTMLImageElementShim,
    ImageData: ShimImageData,
    createImage: () => make(),
    createImageData: (width: number, height: number) => {
      const native = wx.createImageData?.(width, height);
      if (native) {
        const obj = native as object;
        ImageDataShim.__instances.add(obj);
        return obj as MiniImageData;
      }
      return new ShimImageData(width, height);
    },
    createImageBitmap: undefined,
  };
}
