import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base: required for GitHub Pages project sites and Electron file:// loads.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
