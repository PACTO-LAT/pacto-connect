import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Same cross-copy React alignment as connect-react's vitest config: the
// monorepo hoists an older React to the root while this package pins its own
// devDependency, so tests must resolve both to a single copy.
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rootRequire = createRequire(resolve(rootDir, 'noop.js'));
const reactDir = dirname(rootRequire.resolve('react/package.json'));
const reactDomDir = dirname(rootRequire.resolve('react-dom/package.json'));

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: reactDir,
      'react-dom': reactDomDir,
      // The real `react-native` / `react-native-webview` packages require a
      // native runtime (Flow-typed native module bindings) that doesn't run
      // under Node/jsdom. Tests exercise our bridge/hook logic against the
      // lightweight fakes in `src/test/react-native-mock.tsx` instead —
      // consumers still get the real packages' types at build/type-check time
      // via the peer + devDependency entries in package.json.
      'react-native': resolve(
        rootDir,
        'packages/connect-react-native/src/test/react-native-mock.tsx',
      ),
      'react-native-webview': resolve(
        rootDir,
        'packages/connect-react-native/src/test/react-native-webview-mock.tsx',
      ),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
