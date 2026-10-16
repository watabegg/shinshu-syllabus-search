import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({root: new URL('.',import.meta.url).pathname, plugins:[react(),tailwindcss()],resolve:{alias:{'@':new URL('../../../src',import.meta.url).pathname}},server:{host:'0.0.0.0',port:5180,fs:{allow:[new URL('../../../',import.meta.url).pathname]}}});
