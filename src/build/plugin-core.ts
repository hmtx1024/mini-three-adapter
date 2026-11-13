/**
 * Rollup/Vite-compatible plugin core (zero hard dependency on either bundler).
 *
 * Responsibilities:
 *  1. Rewrite free browser globals inside third-party modules to scoped access.
 *  2. Handle `three/webgpu` (WebGPU is unavailable in WeChat mini games).
 *  3. Collect worker/wasm assets referenced by addons and emit them + a manifest.
 *  4. Produce a machine-readable build report for CI and AI-assisted iteration.
 */
import { promises as fs } from 'node:fs';
import {
  DEFAULT_FORCE_UNDEF,
  rewriteGlobals,
  type BuildSourceMap,
  type RewriteOptions,
} from './scope-rewrite';
import {
  collectAssetReferences,
  collectAssets,
  type AssetManifest,
  type AssetOptions,
} from './assets';

export interface MiniThreePluginOptions extends AssetOptions {
  /** Extra modules to transform. Receives a normalized (slash-separated) id. */
  include?: (id: string) => boolean;
  /** Modules to skip even when they match. */
  exclude?: (id: string) => boolean;
  /** Also transform application code (off by default). */
  includeUserCode?: boolean;
  /** Rewrite options (advanced). */
  rewrite?: RewriteOptions;
  /** How to handle `three/webgpu` imports. Default 'warn'. */
  webgpu?: 'warn' | 'error' | 'rewrite' | 'ignore';
  /** Print a build report summary. Default true. */
  report?: boolean;
  /** Verbose per-module logs. */
  debug?: boolean;
}

export interface BuildReport {
  modulesScanned: number;
  modulesRewritten: number;
  rewrites: number;
  globalsSeen: string[];
  assetReferences: string[];
  missingAssets: string[];
  webgpuWarnings: string[];
  parseFailures: string[];
}

export interface PluginContext {
  warn(message: string): void;
  error(message: string): never;
  emitFile(file: { type: 'asset'; fileName: string; source: string | Uint8Array }): string;
}

export interface MiniThreePlugin {
  name: string;
  enforce: 'pre';
  transform(this: PluginContext, code: string, id: string): { code: string; map: BuildSourceMap | null } | null;
  generateBundle(this: PluginContext, options: { dir?: string; file?: string }): Promise<void>;
  api: {
    report(): BuildReport;
  };
}

const DEFAULT_INCLUDE = (id: string): boolean => {
  const normalized = id.replace(/\\/g, '/').split('?')[0] ?? id;
  return (
    normalized.includes('/node_modules/three/') ||
    normalized.includes('/node_modules/three-stdlib/') ||
    normalized.includes('/node_modules/@react-three/') ||
    normalized.includes('/node_modules/@tresjs/') ||
    normalized.includes('/node_modules/.vite/deps/three') ||
    normalized.includes('/node_modules/.vite/deps/three-stdlib') ||
    /\/node_modules\/three@[^/]+\//.test(normalized)
  );
};

export function miniThreePlugin(options: MiniThreePluginOptions = {}): MiniThreePlugin {
  const include = options.include ?? DEFAULT_INCLUDE;
  const exclude = options.exclude ?? (() => false);
  const webgpuMode = options.webgpu ?? 'warn';
  const report: BuildReport = {
    modulesScanned: 0,
    modulesRewritten: 0,
    rewrites: 0,
    globalsSeen: [],
    assetReferences: [],
    missingAssets: [],
    webgpuWarnings: [],
    parseFailures: [],
  };
  const seenGlobals = new Set<string>();
  const assetRefs = new Set<string>();
  let manifest: AssetManifest | null = null;
  let filesToEmit = new Map<string, string>();

  const note = (ctx: PluginContext, message: string): void => {
    if (options.debug) ctx.warn(`[mini-three] ${message}`);
  };

  return {
    name: 'mini-three-adapter',
    enforce: 'pre',

    transform(this: PluginContext, code: string, id: string) {
      const normalized = id.replace(/\\/g, '/');
      const shouldTransform = options.includeUserCode
        ? !normalized.includes('/node_modules/mini-three-adapter/') && !exclude(normalized)
        : include(normalized) && !exclude(normalized);
      if (!shouldTransform) return null;

      report.modulesScanned++;
      for (const ref of collectAssetReferences(code)) assetRefs.add(ref);

      let currentCode = code;
      if (webgpuMode !== 'ignore' && /from\s*['"`]three\/webgpu['"`]/.test(code)) {
        const message = `[mini-three] ${normalized} imports 'three/webgpu'; WebGPU is not available in WeChat mini games.`;
        report.webgpuWarnings.push(message);
        if (webgpuMode === 'error') this.error(message);
        if (webgpuMode === 'warn') this.warn(`${message} Use three's WebGLRenderer instead.`);
        if (webgpuMode === 'rewrite') {
          currentCode = currentCode
            .replace(/(['"`])three\/webgpu\1/g, '$1three$1')
            .replace(/\bWebGPURenderer\b/g, 'WebGLRenderer');
          note(this, `rewrote three/webgpu -> three in ${normalized}`);
        }
      }

      const result = rewriteGlobals(currentCode, normalized, {
        ...options.rewrite,
        ...(options.rewrite?.forceUndef ? {} : { forceUndef: [...DEFAULT_FORCE_UNDEF] }),
      });
      if (result && 'error' in result) {
        report.parseFailures.push(result.error);
        this.warn(`[mini-three] ${result.error}`);
        return null;
      }
      if (!result) return webgpuMode === 'rewrite' ? { code: currentCode, map: null } : null;

      report.modulesRewritten++;
      report.rewrites += result.count;
      for (const name of result.seen) seenGlobals.add(name);
      note(this, `${normalized}: ${result.count} global(s) rewritten (${result.seen.join(', ')})`);
      return { code: result.code, map: result.map };
    },

    async generateBundle(this: PluginContext, bundleOptions) {
      const refs = Array.from(assetRefs);
      report.assetReferences = refs;
      report.globalsSeen = Array.from(seenGlobals).sort();

      if (refs.length > 0) {
        const collected = await collectAssets(refs, {
          cwd: options.cwd,
          roots: options.roots,
          outputDir: options.outputDir,
          brotli: options.brotli,
          manifest: options.manifest,
        });
        manifest = collected.manifest;
        filesToEmit = collected.files;
        report.missingAssets = collected.missing;
        for (const missing of collected.missing) {
          this.warn(`[mini-three] asset not found in known roots: ${missing}`);
        }
        for (const [destination, source] of filesToEmit) {
          try {
            const content = await fs.readFile(source);
            this.emitFile({ type: 'asset', fileName: destination, source: content });
          } catch (error) {
            this.warn(`[mini-three] could not emit ${destination}: ${String(error)}`);
          }
        }
      } else {
        manifest = {
          generatedBy: 'mini-three-adapter',
          outputDir: options.outputDir ?? 'assets/three',
          entries: [],
          gameJsonSuggestion: {},
          decoderPaths: {},
        };
      }

      if (options.manifest !== false) {
        this.emitFile({
          type: 'asset',
          fileName: 'mini-three-assets.json',
          source: JSON.stringify({ ...manifest, build: report, output: bundleOptions.dir ?? bundleOptions.file ?? '' }, null, 2),
        });
      }
      if (options.report !== false) {
        this.warn(
          `[mini-three] build report: ${report.modulesScanned} module(s) scanned, ` +
            `${report.modulesRewritten} rewritten, ${report.rewrites} reference(s) -> scope, ` +
            `${filesToEmit.size} asset(s) emitted, ${report.missingAssets.length} missing.`,
        );
      }
    },

    api: {
      report: () => ({
        ...report,
        globalsSeen: Array.from(seenGlobals).sort(),
        assetReferences: Array.from(assetRefs),
        webgpuWarnings: [...report.webgpuWarnings],
        parseFailures: [...report.parseFailures],
      }),
    },
  };
}
