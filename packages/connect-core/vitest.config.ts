import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: {
      url: 'https://shop.example',
    },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
