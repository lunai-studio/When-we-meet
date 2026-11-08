import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: { firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'] } } },
  },
});
