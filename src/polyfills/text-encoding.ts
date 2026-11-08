/** atob / btoa / TextEncoder / TextDecoder shims (no Buffer, no browser). */
import { base64ToBytes, bytesToBase64 } from './blob-url';

export function atob(data: string): string {
  const bytes = base64ToBytes(String(data));
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

export function btoa(data: string): string {
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 255;
  return bytesToBase64(bytes);
}

export class MiniTextEncoder {
  readonly encoding = 'utf-8';
  encode(input = ''): Uint8Array {
    const bytes: number[] = [];
    for (let i = 0; i < input.length; i++) {
      let cp = input.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < input.length) {
        const low = input.charCodeAt(i + 1);
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
  encodeInto(source: string, destination: Uint8Array): { read: number; written: number } {
    const bytes = this.encode(source);
    const n = Math.min(bytes.length, destination.length);
    destination.set(bytes.subarray(0, n));
    return { read: n === bytes.length ? source.length : source.length, written: n };
  }
}

export interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}
export interface TextDecodeOptions {
  stream?: boolean;
}

export class MiniTextDecoder {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  constructor(label = 'utf-8', options: TextDecoderOptions = {}) {
    this.encoding = (label || 'utf-8').toLowerCase();
    this.fatal = options.fatal ?? false;
    this.ignoreBOM = options.ignoreBOM ?? false;
  }

  decode(input?: ArrayBufferView | ArrayBuffer, _options: TextDecodeOptions = {}): string {
    let bytes: Uint8Array;
    if (!input) bytes = new Uint8Array(0);
    else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
    else bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

    if (this.encoding === 'ascii' || this.encoding === 'latin1' || this.encoding === 'iso-8859-1') {
      let out = '';
      for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i] ?? 0);
      return out;
    }
    if (this.encoding === 'utf-16le' || this.encoding === 'utf-16') {
      let out = '';
      for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8));
      return out;
    }

    let start = 0;
    if (!this.ignoreBOM && bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
    let out = '';
    for (let i = start; i < bytes.length; i++) {
      const a = bytes[i] ?? 0;
      if (a < 0x80) out += String.fromCharCode(a);
      else if (a < 0xe0) out += String.fromCharCode(((a & 31) << 6) | ((bytes[++i] ?? 0) & 63));
      else if (a < 0xf0) {
        const b = bytes[++i] ?? 0;
        const c = bytes[++i] ?? 0;
        out += String.fromCharCode(((a & 15) << 12) | ((b & 63) << 6) | (c & 63));
      } else {
        const b = bytes[++i] ?? 0;
        const c = bytes[++i] ?? 0;
        const d = bytes[++i] ?? 0;
        const cp = ((a & 7) << 18) | ((b & 63) << 12) | ((c & 63) << 6) | (d & 63);
        const v = cp - 0x10000;
        out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 1023));
      }
    }
    return out;
  }
}
