/** fetch / XMLHttpRequest backed by `wx.request`. three.js FileLoader uses fetch. */
import type { WxLike, WxRequestResult } from '../platforms/wx-types';
import { MiniBlob } from './blob-url';
import { MiniEventTarget, MiniProgressEvent } from './event';
import { MiniTextDecoder, MiniTextEncoder } from './text-encoding';

export interface MiniHeaders {
  get(name: string): string | null;
  has(name: string): boolean;
  forEach(callback: (value: string, key: string) => void): void;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}

function createHeaders(init?: Record<string, string>): MiniHeaders {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(init ?? {})) map.set(k.toLowerCase(), v);
  return {
    get: (name) => map.get(name.toLowerCase()) ?? null,
    has: (name) => map.has(name.toLowerCase()),
    forEach: (cb) => map.forEach((value, key) => cb(value, key)),
    [Symbol.iterator]: () => map.entries(),
  };
}

export interface MiniResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly headers: MiniHeaders;
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  blob(): Promise<MiniBlob>;
  clone(): MiniResponse;
}

function toArrayBuffer(data: WxRequestResult['data']): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  if (typeof data === 'string') {
    const bytes = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 255;
    return bytes.buffer;
  }
  const encoded = new MiniTextEncoder().encode(JSON.stringify(data));
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
}

function makeResponse(url: string, result: WxRequestResult): MiniResponse {
  const buffer = toArrayBuffer(result.data);
  let used = false;
  const status = result.statusCode;
  const build = (): MiniResponse => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    url,
    headers: createHeaders(result.header),
    get bodyUsed() {
      return used;
    },
    async arrayBuffer() {
      used = true;
      return buffer.slice(0);
    },
    async text() {
      used = true;
      return new MiniTextDecoder().decode(buffer);
    },
    async json<T>() {
      used = true;
      return JSON.parse(new MiniTextDecoder().decode(buffer)) as T;
    },
    async blob() {
      used = true;
      return new MiniBlob([new Uint8Array(buffer)], {
        type: createHeaders(result.header).get('content-type') ?? '',
      });
    },
    clone: () => build(),
  });
  return build();
}

export type MiniFetch = (input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: { aborted: boolean; addEventListener?(type: string, listener: () => void): void };
}) => Promise<MiniResponse>;

export function createFetch(wx: WxLike): MiniFetch {
  if (typeof wx.request !== 'function') {
    // Browser / Node fallback for tests and H5 dual builds.
    const native = (globalThis as unknown as Record<string, unknown>).fetch as MiniFetch | undefined;
    if (typeof native === 'function') return (input, init) => native(input, init as never);
    return async () => {
      throw new Error('[mini-three-adapter] no wx.request and no native fetch available');
    };
  }
  return (input, init = {}) =>
    new Promise<MiniResponse>((resolve, reject) => {
      const task = wx.request?.({
        url: input,
        method: init.method ?? 'GET',
        header: init.headers,
        data: init.body,
        responseType: 'arraybuffer',
        success: (result) => resolve(makeResponse(input, result)),
        fail: (error) => reject(new Error(error.errMsg ?? `wx.request failed: ${input}`)),
      });
      if (init.signal?.addEventListener) {
        init.signal.addEventListener('abort', () => task?.abort?.());
      }
    });
}

/** Minimal AbortController, used by three's FileLoader abort support. */
export class MiniAbortSignal extends MiniEventTarget {
  aborted = false;
  reason: unknown = undefined;
  throwIfAborted(): void {
    if (this.aborted) throw this.reason ?? new Error('Aborted');
  }
}

export class MiniAbortController {
  readonly signal = new MiniAbortSignal();
  abort(reason?: unknown): void {
    if (this.signal.aborted) return;
    this.signal.aborted = true;
    this.signal.reason = reason ?? new Error('Aborted');
    this.signal.dispatchEvent({ type: 'abort', target: this.signal });
  }
}

/**
 * Small XMLHttpRequest-compatible class. Modern three.js uses fetch, but many
 * addons (and older three versions) still instantiate XMLHttpRequest directly.
 */
export class MiniXMLHttpRequest extends MiniEventTarget {
  static readonly UNSENT = 0;
  static readonly OPENED = 1;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly DONE = 4;

  readyState = 0;
  status = 0;
  statusText = '';
  response: unknown = null;
  responseText = '';
  responseType = '';
  responseURL = '';
  timeout = 0;
  withCredentials = false;
  onreadystatechange: ((event: unknown) => void) | null = null;
  onload: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onprogress: ((event: unknown) => void) | null = null;
  onabort: ((event: unknown) => void) | null = null;

  private method = 'GET';
  private url = '';
  private headers: Record<string, string> = {};
  private body: unknown = undefined;

  constructor(private readonly wx: WxLike) {
    super();
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
    this.responseURL = url;
    this.readyState = 1;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  getAllResponseHeaders(): string {
    return '';
  }

  send(body?: unknown): void {
    this.body = body;
    if (typeof this.wx.request !== 'function') {
      this.fail(new Error('wx.request unavailable'));
      return;
    }
    this.wx.request({
      url: this.url,
      method: this.method,
      header: this.headers,
      data: this.body,
      responseType: this.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
      success: (result) => {
        this.status = result.statusCode;
        const buffer = toArrayBuffer(result.data);
        this.response = this.responseType === 'arraybuffer' ? buffer : new MiniTextDecoder().decode(buffer);
        this.responseText = typeof this.response === 'string' ? this.response : '';
        this.readyState = 4;
        this.onreadystatechange?.({ type: 'readystatechange' });
        this.dispatchEvent(new MiniProgressEvent('progress', { loaded: buffer.byteLength, total: buffer.byteLength, lengthComputable: true }));
        this.onload?.({ type: 'load' });
        this.dispatchEvent({ type: 'load', target: this });
        this.dispatchEvent({ type: 'loadend', target: this });
      },
      fail: (error) => this.fail(new Error(error.errMsg ?? 'wx.request failed')),
    });
  }

  abort(): void {
    this.readyState = 4;
    this.onabort?.({ type: 'abort' });
    this.dispatchEvent({ type: 'abort', target: this });
  }

  private fail(error: Error): void {
    this.status = 0;
    this.readyState = 4;
    this.onerror?.(error);
    this.dispatchEvent({ type: 'error', target: this });
    this.dispatchEvent({ type: 'loadend', target: this });
  }
}

export function createXMLHttpRequestFactory(wx: WxLike): typeof MiniXMLHttpRequest {
  return class extends MiniXMLHttpRequest {
    constructor() {
      super(wx);
    }
  };
}
