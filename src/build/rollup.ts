/** Rollup entry: `import { miniThree } from 'mini-three-adapter/rollup'`. */
import { miniThreePlugin, type MiniThreePlugin, type MiniThreePluginOptions } from './plugin-core';

export function miniThree(options: MiniThreePluginOptions = {}): MiniThreePlugin {
  return miniThreePlugin(options);
}

export default miniThree;
export { miniThreePlugin } from './plugin-core';
export type { MiniThreePluginOptions, BuildReport } from './plugin-core';
export { DEFAULT_GLOBAL_NAMES, DEFAULT_FORCE_UNDEF, rewriteGlobals } from './scope-rewrite';
export type { RewriteOptions, RewriteResult } from './scope-rewrite';
export { collectAssetReferences, collectAssets, copyAssets } from './assets';
export type { AssetOptions, AssetManifest, AssetEntry } from './assets';
