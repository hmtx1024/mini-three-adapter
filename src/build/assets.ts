/**
 * Worker / WASM asset collection for three.js addons.
 *
 * DRACOLoader, KTX2Loader, 3DMLoader, LottieLoader, ... reference decoder
 * `.js` and `.wasm` files by string path. In a mini game those files are not
 * reachable via HTTP; they must be copied into the code package (ideally a
 * subpackage) and `setDecoderPath` must point at the copied location.
 *
 * The plugin scans transformed modules, resolves each referenced basename in a
 * small set of known directories, copies it, and emits a manifest plus a
 * `game.json` suggestion. No global state, no hidden writes.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface AssetOptions {
  /** Extra directories to search (besides three's jsm/libs). */
  roots?: string[];
  /** Output directory relative to the bundle root. Default 'assets/three'. */
  outputDir?: string;
  /** Copy `.wasm.br` alongside `.wasm` when available. Default true. */
  brotli?: boolean;
  /** Emit `mini-three-assets.json`. Default true. */
  manifest?: boolean;
  /** Working directory used to resolve roots. Default process.cwd(). */
  cwd?: string;
}

export interface AssetEntry {
  /** Original string found in the module. */
  reference: string;
  /** Resolved absolute source path. */
  source: string;
  /** Relative destination inside the bundle. */
  destination: string;
  kind: 'worker' | 'wasm' | 'data';
}

export interface AssetManifest {
  generatedBy: 'mini-three-adapter';
  outputDir: string;
  entries: AssetEntry[];
  /** Paste into game.json (adjust subpackage names to your project). */
  gameJsonSuggestion: Record<string, unknown>;
  /** Decoder paths to feed to loaders at runtime. */
  decoderPaths: Record<string, string>;
}

const ASSET_PATTERN = /(['"`])([^'"`\n]*\.(?:wasm|wasm\.br|bin|js))\1/g;
const DECODER_KEYWORDS = [
  'draco', 'basis', 'ktx2', 'rhino3dm', 'zstd', 'meshopt', 'ammo',
  'worker', 'decoder', 'transcoder', 'lottie', 'sdf',
];

export function collectAssetReferences(code: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  ASSET_PATTERN.lastIndex = 0;
  while ((match = ASSET_PATTERN.exec(code)) !== null) {
    const value = match[2] ?? '';
    const lower = value.toLowerCase();
    if (DECODER_KEYWORDS.some((keyword) => lower.includes(keyword))) found.add(value);
  }
  return Array.from(found);
}

async function indexFiles(root: string, maxDepth = 5): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && !index.has(entry.name)) index.set(entry.name, full);
    }
  };
  await walk(root, 0);
  return index;
}

function classify(name: string): AssetEntry['kind'] {
  if (name.endsWith('.wasm') || name.endsWith('.wasm.br')) return 'wasm';
  if (name.endsWith('.js')) return 'worker';
  return 'data';
}

export function defaultRoots(cwd: string): string[] {
  return [
    path.join(cwd, 'node_modules/three/examples/jsm/libs'),
    path.join(cwd, 'node_modules/three/examples/jsm'),
    path.join(cwd, 'node_modules/three-stdlib'),
    path.join(cwd, 'public'),
    path.join(cwd, 'static'),
  ];
}

export interface CollectResult {
  manifest: AssetManifest;
  /** Files to write: destination (relative) -> absolute source. */
  files: Map<string, string>;
  missing: string[];
}

/** Resolve references against known roots without copying anything. */
export async function collectAssets(references: string[], options: AssetOptions = {}): Promise<CollectResult> {
  const cwd = options.cwd ?? process.cwd();
  const outputDir = (options.outputDir ?? 'assets/three').replace(/\\/g, '/').replace(/\/$/, '');
  const roots = [...defaultRoots(cwd), ...(options.roots ?? [])];
  const indexes = await Promise.all(roots.map((root) => indexFiles(root)));
  const find = (name: string): string | undefined => {
    for (const index of indexes) {
      const hit = index.get(name);
      if (hit) return hit;
    }
    return undefined;
  };

  const entries: AssetEntry[] = [];
  const files = new Map<string, string>();
  const missing: string[] = [];

  for (const reference of references) {
    const base = path.posix.basename(reference.split('?')[0] ?? reference);
    const source = find(base);
    if (!source) { missing.push(reference); continue; }
    const entry: AssetEntry = {
      reference,
      source,
      destination: `${outputDir}/${base}`,
      kind: classify(base),
    };
    entries.push(entry);
    files.set(entry.destination, source);
    if (options.brotli !== false && entry.kind === 'wasm') {
      const br = find(`${base}.br`);
      if (br) {
        entries.push({ reference: `${reference}.br`, source: br, destination: `${outputDir}/${base}.br`, kind: 'wasm' });
        files.set(`${outputDir}/${base}.br`, br);
      }
    }
  }

  const decoderPaths: Record<string, string> = {};
  for (const entry of entries) {
    const name = path.posix.basename(entry.destination).toLowerCase();
    for (const key of ['draco', 'ktx2', 'basis', 'meshopt', 'rhino3dm', 'zstd', 'ammo']) {
      if (name.includes(key)) decoderPaths[key] = `${outputDir}/`;
    }
  }

  const manifest: AssetManifest = {
    generatedBy: 'mini-three-adapter',
    outputDir,
    entries,
    gameJsonSuggestion: {
      workers: { path: `${outputDir}`, isSubpackage: true },
      subpackages: [{ name: 'three-assets', root: `${outputDir}/` }],
    },
    decoderPaths,
  };
  return { manifest, files, missing };
}

/** Copy resolved files into `outDir`. */
export async function copyAssets(files: Map<string, string>, outDir: string): Promise<number> {
  let written = 0;
  for (const [destination, source] of files) {
    const target = path.join(outDir, destination);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    written++;
  }
  return written;
}
