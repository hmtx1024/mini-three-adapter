/** Best-effort runtime capability detection; never throws, never steals the on-screen canvas. */
import type { WxLike } from '../platforms/wx-types';
import type { Capabilities, ContextType } from '../types';

export interface DetectOptions {
  /** Explicit overrides win over probing (useful in tests / known device tiers). */
  overrides?: Partial<Capabilities>;
  /** Probe function supplied by the platform. Must NOT call wx.createCanvas(). */
  probeContext?: (type: ContextType) => boolean;
}

function safe(fn: () => unknown, fallback: unknown = false): unknown {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function readBaseLibraryVersion(wx: WxLike): string {
  const direct = (wx as unknown as Record<string, unknown>).SDKVersion;
  if (typeof direct === 'string') return direct;
  const info = safe(() => wx.getSystemInfoSync?.()) as
    | { SDKVersion?: string; platform?: string }
    | undefined;
  return info?.SDKVersion ?? '';
}

export function detectCapabilities(
  wx: WxLike,
  platform: Capabilities['platform'],
  options: DetectOptions = {},
): Capabilities {
  const version = readBaseLibraryVersion(wx);
  const has = (key: string): boolean => typeof (wx as Record<string, unknown>)[key] === 'function';

  const webgl2 = options.probeContext
    ? Boolean(safe(() => options.probeContext?.('webgl2'), false))
    : versionAtLeast(version, '2.20.0');
  const webgl1 = options.probeContext
    ? Boolean(safe(() => options.probeContext?.('webgl'), true))
    : true;

  const caps: Capabilities = {
    platform,
    webgl2,
    webgl1,
    offscreenCanvas: has('createOffscreenCanvas'),
    worker: has('createWorker'),
    wasm: typeof (globalThis as unknown as Record<string, unknown>).WXWebAssembly === 'object' ||
      typeof (globalThis as unknown as Record<string, unknown>).WebAssembly === 'object',
    brotliWasm: versionAtLeast(version, '2.14.0'),
    nativeImage: has('createImage') || has('createOffscreenCanvas'),
    triggerGC: has('triggerGC'),
    getWindowInfo: has('getWindowInfo'),
    windowResizeEvent: has('onWindowResize') && has('offWindowResize'),
    baseLibraryVersion: version,
  };
  return { ...caps, ...options.overrides };
}

/** Compare dotted base library versions without a semver dependency. */
export function versionAtLeast(actual: string, required: string): boolean {
  if (!actual) return true; // unknown -> assume modern, probe will correct
  const a = actual.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const b = required.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}
