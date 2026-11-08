/** Vite entry: `import miniThree from 'mini-three-adapter/vite'`. */
import { miniThreePlugin, type MiniThreePlugin, type MiniThreePluginOptions } from './plugin-core';

export interface ViteMiniThreePlugin extends MiniThreePlugin {
  config(): Record<string, unknown>;
}

/**
 * Vite plugin. `optimizeDeps.exclude` keeps three's ESM sources intact so the
 * AST rewrite sees the original module graph instead of a pre-bundled blob.
 */
export function miniThree(options: MiniThreePluginOptions = {}): ViteMiniThreePlugin {
  const core = miniThreePlugin(options);
  return {
    ...core,
    config() {
      return {
        optimizeDeps: {
          exclude: ['three', 'three-stdlib', 'three/examples/jsm'],
        },
        build: {
          commonjsOptions: { transformMixedEsModules: true },
          rollupOptions: {
            output: {
              manualChunks: undefined,
            },
          },
        },
      };
    },
  };
}

export default miniThree;
export { miniThreePlugin } from './plugin-core';
export type { MiniThreePluginOptions, BuildReport } from './plugin-core';
