import { cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, '..', 'out');
const targetDir = join(root, '..', '..', '..', 'public', 'examples', 'react');

rmSync(targetDir, { recursive: true, force: true });
cpSync(outDir, targetDir, { recursive: true });

console.log(`Copied ${outDir} → ${targetDir}`);
