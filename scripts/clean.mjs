import { rmSync } from 'node:fs';

// Publishing always builds from scratch so hashed chunks from older builds
// never leak into the tarball.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
console.log('[mini-three-adapter] dist cleaned');
