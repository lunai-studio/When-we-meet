import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site under /<repo>/. Override with VITE_BASE for a custom domain.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/when-we-meet/',
});
