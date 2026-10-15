import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { inertiaPages } from '@hono/inertia/vite';
import ssrPlugin from 'vite-ssr-components/plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    inertiaPages({ serverModule: '../src/server' }),
    react(),
    tailwindcss(),
    cloudflare(),
    ssrPlugin({ entry: { target: ['app/root-view.tsx'] } }),
  ],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  build: { sourcemap: true },
});
