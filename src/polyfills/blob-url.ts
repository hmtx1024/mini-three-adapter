/**
 * Blob + URL shims. WeChat mini games have neither. GLTFLoader, KTX2Loader,
 * EXRLoader and several addons call `URL.createObjectURL(new Blob([...]))`.
 *
 * Object URLs are resolved to `data:` URIs instead of `blob:` URIs. The WeChat
 * image loader understands `data:` directly, so no interception of `Image.src`
 * is needed and there is no global URL scheme registry to leak.
 */

export type BlobPart = string | ArrayBuffer | ArrayBufferView | MiniBlob;

const encoderTable = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += encoderTable.charAt((n >> 18) & 63) + encoderTable.charAt((n >> 12) & 63);
    out += i + 1 < bytes.length ? encoderTable.charAt((n >> 6) & 63) : '=';
    out += i + 2 < bytes.length ? encoderTable.charAt(n & 63) : '=';
  }
  return out;
}

export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = encoderTable.indexOf(clean[i] ?? '');
    const b = encoderTable.indexOf(clean[i + 1] ?? '');
    const c = encoderTable.indexOf(clean[i + 2] ?? '');
    const d = encoderTable.indexOf(clean[i + 3] ?? '');
    const n = ((a < 0 ? 0 : a) << 18) | ((b < 0 ? 0 : b) << 12) |
      ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    if (p < out.length) out[p++] = (n >> 16) & 255;
    if (p < out.length) out[p++] = (n >> 8) & 255;
    if (p < out.length) out[p++] = n & 255;
  }
  return out.subarray(0, p);
}

function partToBytes(part: BlobPart): Uint8Array {
  if (typeof part === 'string') {
    // UTF-8 encode without TextEncoder dependency (kept tiny & portable).
    const bytes: number[] = [];
    for (let i = 0; i < part.length; i++) {
      let cp = part.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < part.length) {
        const low = part.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
          i++;
        }
      }
      if (cp < 0x80) bytes.push(cp);
      else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return new Uint8Array(bytes);
  }
  if (part instanceof MiniBlob) return part.bytes();
  if (part instanceof ArrayBuffer) return new Uint8Array(part);
  return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
}

export class MiniBlob {
  readonly type: string;
  readonly size: number;
  private readonly parts: BlobPart[];

  constructor(parts: BlobPart[] = [], options: { type?: string } = {}) {
    this.parts = parts;
    this.type = options.type ?? '';
    this.size = parts.reduce((sum, part) => sum + partToBytes(part).byteLength, 0);
  }

  bytes(): Uint8Array {
    const chunks = this.parts.map(partToBytes);
    const out = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = this.bytes();
    return Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }

  text(): Promise<string> {
    return Promise.resolve(new TextDecoderLike().decode(this.bytes()));
  }

  slice(start = 0, end = this.size, contentType = ''): MiniBlob {
    return new MiniBlob([this.bytes().slice(start, end)], { type: contentType });
  }

  dataURL(): string {
    return `data:${this.type || 'application/octet-stream'};base64,${bytesToBase64(this.bytes())}`;
  }
}

/** Tiny UTF-8 decoder used by Blob.text(); the full one lives in text-encoding.ts. */
class TextDecoderLike {
  decode(input: Uint8Array): string {
    let out = '';
    for (let i = 0; i < input.length; i++) {
      const a = input[i] ?? 0;
      if (a < 0x80) out += String.fromCharCode(a);
      else if (a < 0xe0) out += String.fromCharCode(((a & 31) << 6) | ((input[++i] ?? 0) & 63));
      else if (a < 0xf0) {
        const b = input[++i] ?? 0;
        const c = input[++i] ?? 0;
        out += String.fromCharCode(((a & 15) << 12) | ((b & 63) << 6) | (c & 63));
      } else {
        const b = input[++i] ?? 0;
        const c = input[++i] ?? 0;
        const d = input[++i] ?? 0;
        const cp = ((a & 7) << 18) | ((b & 63) << 12) | ((c & 63) << 6) | (d & 63);
        const v = cp - 0x10000;
        out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 1023));
      }
    }
    return out;
  }
}

let objectUrlSeed = 0;
const objectUrls = new Map<string, MiniBlob>();
export const OBJECT_URL_PREFIX = 'mini-three-blob:';

export interface URLSearchParamsLike {
  get(name: string): string | null;
  set(name: string, value: string): void;
  toString(): string;
}

export class MiniURLSearchParams implements URLSearchParamsLike {
  private readonly map = new Map<string, string>();
  constructor(init = '') {
    const q = init.startsWith('?') ? init.slice(1) : init;
    if (!q) return;
    for (const pair of q.split('&')) {
      const [k, v = ''] = pair.split('=');
      if (k) this.map.set(decodeURIComponent(k), decodeURIComponent(v));
    }
  }
  get(name: string): string | null {
    return this.map.has(name) ? (this.map.get(name) as string) : null;
  }
  set(name: string, value: string): void {
    this.map.set(name, value);
  }
  toString(): string {
    const parts: string[] = [];
    for (const [k, v] of this.map) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    return parts.join('&');
  }
}

/** Lightweight URL implementation: enough for three.js loaders and addons. */
export class MiniURL {
  href: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  searchParams: MiniURLSearchParams;

  constructor(url: string, base?: string | MiniURL) {
    const resolved = resolveUrl(url, base);
    const m = /^([a-z][a-z\d+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(resolved);
    if (m) {
      this.protocol = m[1] ?? '';
      this.host = m[2] ?? '';
      this.pathname = m[3] || '/';
      this.search = m[4] ?? '';
      this.hash = m[5] ?? '';
      const hp = /^([^:]*)(?::(\d+))?$/.exec(this.host);
      this.hostname = hp?.[1] ?? this.host;
      this.port = hp?.[2] ?? '';
      this.origin = `${this.protocol}//${this.host}`;
    } else {
      this.protocol = '';
      this.host = '';
      this.hostname = '';
      this.port = '';
      this.pathname = resolved;
      this.search = '';
      this.hash = '';
      this.origin = 'null';
    }
    this.href = `${this.origin === 'null' ? '' : this.origin}${this.pathname}${this.search}${this.hash}`;
    this.searchParams = new MiniURLSearchParams(this.search);
  }

  toString(): string {
    return this.href;
  }

  static createObjectURL(blob: MiniBlob | Blob): string {
    const mini = blob instanceof MiniBlob
      ? blob
      : new MiniBlob([], { type: (blob as Blob).type });
    const id = `${OBJECT_URL_PREFIX}${Date.now().toString(36)}-${(objectUrlSeed++).toString(36)}`;
    objectUrls.set(id, mini);
    return id;
  }

  static revokeObjectURL(url: string): void {
    objectUrls.delete(url);
  }

  /** Resolve a `mini-three-blob:` URL back to its data URI. */
  static resolveObjectURL(url: string): string | null {
    const blob = objectUrls.get(url);
    return blob ? blob.dataURL() : null;
  }

  static clearObjectURLs(): void {
    objectUrls.clear();
  }
}

/** Resolve `url` against `base` without relying on a browser URL implementation. */
export function resolveUrl(url: string, base?: string | MiniURL): string {
  const baseHref = typeof base === 'string' ? base : base?.href;
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//')) {
    return url.startsWith('//') && baseHref
      ? `${new MiniURL(baseHref).protocol}${url}`
      : url;
  }
  if (!baseHref) return url;
  const b = new MiniURL(baseHref);
  if (url.startsWith('/')) return `${b.origin}${url}`;
  const dir = b.pathname.slice(0, b.pathname.lastIndexOf('/') + 1);
  const combined = `${b.origin}${dir}${url}`;
  // collapse `..` / `.` segments
  const m = /^([a-z][a-z\d+.-]*:\/\/[^/]+)(\/.*)$/i.exec(combined);
  if (!m) return combined;
  const segments: string[] = [];
  for (const seg of (m[2] ?? '').split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  return `${m[1]}/${segments.join('/')}`;
}
