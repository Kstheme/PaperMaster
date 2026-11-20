import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Serve math fonts from the same origin without relaxing the local service CSP.
    assetsInlineLimit: 0,
  },
});
