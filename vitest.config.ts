import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    env: {
      // React's CJS build only exports act in the development bundle.
      // Tests need act via @testing-library/react, so force development mode.
      NODE_ENV: 'development',
    },
  },
});
