import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/shell'),
  base: '/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(import.meta.dirname, 'out/shell'),
    emptyOutDir: true,
  },
});
