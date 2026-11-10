/** Best-effort runtime capability detection; never throws, never steals the on-screen canvas. */
import type { WxLike } from '../platforms/wx-types';
import type { Capabilities, ContextType } from '../types';
import type { Diagnostics } from './diagnostics';

export interface DetectOptions {
  /** Explicit overrides win over probing (useful in tests / known device tiers). */
  overrides?: Partial<Capabilities>;
  /**
   * Probe function supplied by the platform. Must NOT create the on-screen
   * canvas.
   *
   * Return `undefined` when the host cannot answer at all (for example a base
   * library without `wx.createOffscreenCanvas`). "Cannot probe" is not the same
   * answer as "not supported": an unprobeable host falls back to the base
   * library version heuristic instead of reporting `false`.
   */
  probeContext?: (type: ContextType) => boolean | undefined;
  /** Used to explain an inconclusive probe instead of failing silently. */
  diagnostics?: Diagnostics;
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

  const probe = (type: ContextType): boolean | null => {
    if (!options.probeContext) return null;
    const result = safe(() => options.probeContext?.(type), undefined);
    return typeof result === 'boolean' ? result : null;
  };

  const probedWebgl2 = probe('webgl2');
  const probedWebgl1 = probe('webgl');
  // An inconclusive probe must not be read as "unsupported": base libraries
  // report their WebGL2 support through the version number anyway.
  const webgl2 = probedWebgl2 ?? versionAtLeast(version, '2.20.0');
  const webgl1 = probedWebgl1 ?? true;

  if (options.probeContext && probedWebgl2 == null) {
    options.diagnostics?.warnOnce(
      'webgl2-unprobed',
      `WebGL2 could not be probed on this host (no usable offscreen canvas); ` +
        `assuming ${webgl2} from base library "${version || 'unknown'}". ` +
        `Pass capabilities.webgl2 to override if this is wrong.`,
    );
  }

  const webgl2Source: Capabilities['webgl2Source'] =
    options.overrides?.webgl2 !== undefined ? 'override' : probedWebgl2 == null ? 'inferred' : 'probe';

  const caps: Capabilities = {
    platform,
    webgl2,
    webgl1,
    webgl2Source,
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
