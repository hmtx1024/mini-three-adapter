import { describe, expect, it } from 'vitest';
import { collectAssetReferences, collectAssets } from '../src/build/assets';
import { miniThreePlugin } from '../src/build/plugin-core';
import type { PluginContext } from '../src/build/plugin-core';

function ctx(): PluginContext & { warnings: string[]; emitted: Array<{ fileName: string; source: string | Uint8Array }> } {
  const warnings: string[] = [];
  const emitted: Array<{ fileName: string; source: string | Uint8Array }> = [];
  return {
    warnings,
    emitted,
    warn: (m: string) => { warnings.push(m); },
    error: (m: string) => { throw new Error(m); },
    emitFile: (f) => { emitted.push(f); return f.fileName; },
  };
}

describe('asset collection', () => {
  it('finds decoder/worker references', () => {
    const code = `
      const draco = 'draco_decoder_gltf.wasm';
      const worker = './libs/draco/gltf/with-wasm-decoder.js';
      const unrelated = './utils/helper.js';
      const ktx = "basis_transcoder.wasm.br";
    `;
    const refs = collectAssetReferences(code);
    expect(refs).toContain('draco_decoder_gltf.wasm');
    expect(refs).toContain('./libs/draco/gltf/with-wasm-decoder.js');
    expect(refs).toContain('basis_transcoder.wasm.br');
    expect(refs).not.toContain('./utils/helper.js');
  });

  it('reports unresolved references instead of throwing', async () => {
    const result = await collectAssets(['missing_decoder.wasm'], { cwd: process.cwd(), manifest: false });
    expect(result.missing).toEqual(['missing_decoder.wasm']);
    expect(result.files.size).toBe(0);
    expect(result.manifest.outputDir).toBe('assets/three');
  });
});

describe('plugin core', () => {
  it('rewrites only matching modules', () => {
    const plugin = miniThreePlugin({ report: false });
    const context = ctx();
    const transformed = plugin.transform.call(
      context,
      'export const w = window.innerWidth;',
      '/project/node_modules/three/build/three.module.js',
    );
    expect(transformed?.code).toContain('__m3().window.innerWidth');
    expect(plugin.transform.call(context, 'window.innerWidth', '/project/src/main.ts')).toBeNull();
    expect(plugin.api.report().modulesRewritten).toBe(1);
  });

  it('warns on three/webgpu imports', () => {
    const plugin = miniThreePlugin({ report: false });
    const context = ctx();
    plugin.transform.call(
      context,
      "import { WebGPURenderer } from 'three/webgpu';\nexport const x = window.innerWidth;",
      '/project/node_modules/three/build/three.webgpu.js',
    );
    expect(context.warnings.join(' ')).toContain('WebGPU is not available');
    expect(plugin.api.report().webgpuWarnings).toHaveLength(1);
  });

  it('emits an asset manifest during generateBundle', async () => {
    const plugin = miniThreePlugin({ report: false, cwd: process.cwd() });
    const context = ctx();
    await plugin.generateBundle.call(context, { dir: 'dist' });
    expect(context.emitted.some((f) => f.fileName === 'mini-three-assets.json')).toBe(true);
  });
});
