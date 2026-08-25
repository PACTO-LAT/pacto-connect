import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specEntry = path.join(repoRoot, 'services/connect-gateway/openapi/openapi.yaml');
const bundledSpecPath = path.join(
  repoRoot,
  'services/connect-gateway/openapi/gateway.bundled.yaml',
);
const outputPath = path.join(repoRoot, 'packages/connect-core/src/generated/openapi.ts');

async function main(): Promise<void> {
  const bundled = await SwaggerParser.bundle(specEntry);
  mkdirSync(path.dirname(bundledSpecPath), { recursive: true });
  writeFileSync(bundledSpecPath, JSON.stringify(bundled, null, 2));

  mkdirSync(path.dirname(outputPath), { recursive: true });
  execFileSync('npx', ['openapi-typescript', bundledSpecPath, '-o', outputPath], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  const generated = readFileSync(outputPath, 'utf8');
  if (!generated.startsWith('// @ts-nocheck')) {
    writeFileSync(outputPath, `// @ts-nocheck\n${generated}`);
  }

  console.log(`Generated ${path.relative(repoRoot, outputPath)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
