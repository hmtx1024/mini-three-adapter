/** Structured, level-filtered diagnostics. No console spam in production. */
import type { Capabilities } from '../types';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';
const LEVEL_ORDER: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

export type Reporter = (level: Exclude<LogLevel, 'silent'>, message: string, payload?: unknown) => void;

export interface Diagnostics {
  readonly level: LogLevel;
  error(message: string, payload?: unknown): void;
  warn(message: string, payload?: unknown): void;
  info(message: string, payload?: unknown): void;
  debug(message: string, payload?: unknown): void;
  /** Warn once per unique key (avoids per-frame warnings). */
  warnOnce(key: string, message: string, payload?: unknown): void;
  capabilityReport(caps: Capabilities): string;
}

const defaultReporter: Reporter = (level, message, payload) => {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  const prefix = `[mini-three] ${level.toUpperCase()} ${message}`;
  if (payload === undefined) fn(prefix);
  else fn(prefix, payload);
};

export function createDiagnostics(
  level: LogLevel = 'warn',
  reporter: Reporter = defaultReporter,
): Diagnostics {
  const seen = new Set<string>();
  const emit = (l: Exclude<LogLevel, 'silent'>, message: string, payload?: unknown): void => {
    if (LEVEL_ORDER[level] >= LEVEL_ORDER[l]) reporter(l, message, payload);
  };
  return {
    level,
    error: (m, p) => emit('error', m, p),
    warn: (m, p) => emit('warn', m, p),
    info: (m, p) => emit('info', m, p),
    debug: (m, p) => emit('debug', m, p),
    warnOnce: (key, m, p) => {
      if (seen.has(key)) return;
      seen.add(key);
      emit('warn', m, p);
    },
    capabilityReport: (caps) => capabilityReport(caps),
  };
}

/** Human-readable, copy-pasteable report for bug reports and AI debugging. */
export function capabilityReport(caps: Capabilities): string {
  const lines = [
    'mini-three-adapter capability report',
    `  platform            : ${caps.platform}`,
    `  baseLibraryVersion  : ${caps.baseLibraryVersion || 'unknown'}`,
    `  WebGL2 / WebGL1     : ${caps.webgl2} / ${caps.webgl1}`,
    `  WebGL2 source       : ${caps.webgl2Source ?? 'unknown'}`,
    `  offscreenCanvas     : ${caps.offscreenCanvas}`,
    `  worker / wasm       : ${caps.worker} / ${caps.wasm} (brotli: ${caps.brotliWasm})`,
    `  nativeImage         : ${caps.nativeImage}`,
    `  triggerGC           : ${caps.triggerGC}`,
    `  getWindowInfo       : ${caps.getWindowInfo} (resize events: ${caps.windowResizeEvent})`,
  ];
  if (!caps.webgl2 && caps.webgl2Source === 'inferred') {
    lines.push(
      '  !! WebGL2 was NOT probed, only inferred from the base library version:',
    );
    lines.push('     verify with an explicit capabilities.webgl2 override before downgrading.');
  } else if (!caps.webgl2) {
    lines.push('  !! WebGL2 unavailable: three.js >= r163 requires WebGL2.');
  }
  return lines.join('\n');
}
