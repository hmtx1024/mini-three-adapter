import { defineConfig } from 'tsup';

const runtimeEntries = {
  index: 'src/index.ts',
  'core/index': 'src/core/index.ts',
  scope: 'src/scope.ts',
  'polyfills/index': 'src/polyfills/index.ts',
  'platforms/browser': 'src/platforms/browser.ts',
  'platforms/wechat-game': 'src/platforms/wechat-game.ts',
  'platforms/wechat-miniprogram': 'src/platforms/wechat-miniprogram.ts',
};

/** Runtime code: shipped into the mini game bundle. ES2019 keeps it free of
 *  optional chaining / nullish coalescing so old devtools can consume it. */
const runtime = defineConfig({
  entry: runtimeEntries,
  outDir: 'dist',
  format: ['esm'],
  target: 'es2019',
  platform: 'neutral',
  splitting: true,
  sourcemap: true,
  dts: true,
  clean: false,
  treeshake: true,
  minify: false,
  external: ['three'],
});

/** Build-time plugin code: runs in Node, never in the mini game. */
const buildTooling = defineConfig({
  entry: {
    'build/vite': 'src/build/vite.ts',
    'build/rollup': 'src/build/rollup.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  dts: true,
  clean: false,
  minify: false,
  external: ['vite', 'rollup', 'three'],
});

export default [runtime, buildTooling];
