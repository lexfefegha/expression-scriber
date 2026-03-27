import { defineConfig } from 'vite';

const crossOriginHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    open: true,
    port: 3000,
    headers: crossOriginHeaders,
  },
  preview: {
    headers: crossOriginHeaders,
  },
  build: {
    outDir: 'dist',
  },
});
