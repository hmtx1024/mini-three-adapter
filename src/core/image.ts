/** Image / ImageData / HTMLImageElement shims built on wx.createImage. */
import type { WxImage, WxLike } from '../platforms/wx-types';
import { MiniURL } from '../polyfills/blob-url';
import { MiniEvent } from '../polyfills/event';
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
    Object.defineProperty(raw, 'src', {
      configurable: true,
      enumerable: true,
      get: () => (srcDescriptor?.get ? srcDescriptor.get.call(raw) : currentSrc),
      set: (value: string) => {
        const next = resolveSrc(String(value));
        currentSrc = next;
        if (srcDescriptor?.set) srcDescriptor.set.call(raw, next);
        else if (!srcDescriptor) {
          diagnostics?.warnOnce('image-no-src-setter', 'wx image has no src setter; loading may not trigger');
        }
      },
    });

    // Bridge wx's onload/onerror callbacks into the EventTarget API.
    const dispatch = (event: unknown): void => {
      (raw as unknown as { dispatchEvent(e: unknown): void }).dispatchEvent(event);
    };
    for (const [prop, eventName] of [['onload', 'load'], ['onerror', 'error']] as const) {
      let handler: ((event?: unknown) => void) | null | undefined;
      Object.defineProperty(raw, prop, {
        configurable: true,
        enumerable: true,
        get: () => handler,
        set: (next: ((event?: unknown) => void) | null) => {
          // wx reads `img.onload` when loading finishes; that call now also
          // reaches listeners registered through addEventListener('load').
          handler = (e?: unknown) => {
            dispatch(new MiniEvent(eventName));
            next?.(e);
          };
        },
      });
    }

    Object.defineProperty(raw, 'crossOrigin', { value: '', writable: true, configurable: true });
    Object.defineProperty(raw, 'decode', {
      value: () => new Promise<void>((resolve, reject) => {
        if (raw.complete) return resolve();
        const previousLoad = raw.onload;
        const previousError = raw.onerror;
        raw.onload = () => { previousLoad?.(); resolve(); };
        raw.onerror = (e) => { previousError?.(e); reject(e); };
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
