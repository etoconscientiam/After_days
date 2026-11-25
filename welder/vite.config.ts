import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  // Inline the pixel font into the bundle (the game ships as one file).
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000, assetsInlineLimit: 65536 },
  server: { host: true, port: 5174 },
});
