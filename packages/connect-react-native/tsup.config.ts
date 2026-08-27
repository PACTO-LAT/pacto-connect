import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: [
    'react',
    'react-native',
    'react-native-webview',
    'react-native-keychain',
    'react-native-biometrics',
    'jail-monkey',
    'react-native-ssl-pinning',
  ],
});
