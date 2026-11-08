/**
 * Copy static mini game files into the build output and print a short checklist.
 * Run after `vite build`.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'dist');
await mkdir(out, { recursive: true });
await copyFile(path.join(root, 'game.json'), path.join(out, 'game.json'));

const manifest = path.join(out, 'mini-three-assets.json');
if (existsSync(manifest)) {
  const data = JSON.parse(await readFile(manifest, 'utf8'));
  console.log('[mini-three] emitted assets:', data.entries?.length ?? 0);
  if (data.gameJsonSuggestion && Object.keys(data.gameJsonSuggestion).length > 0) {
    const suggestionPath = path.join(out, 'game.json.suggestion.json');
    await writeFile(suggestionPath, JSON.stringify(data.gameJsonSuggestion, null, 2));
    console.log('[mini-three] game.json hint ->', suggestionPath);
  }
}
console.log('[mini-three] open 微信开发者工具 with project root:', root);
