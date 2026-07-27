import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base + classic-script worker so the build also runs from file://
  // inside the Electron desktop shell.
  base: './',
  worker: { format: 'iife' },
});
