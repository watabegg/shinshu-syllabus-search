import '@vitejs/plugin-react/preamble';
import { createInertiaApp, type ResolvedComponent } from '@inertiajs/react';
import { createRoot } from 'react-dom/client';

const pages = import.meta.glob<{ default: ResolvedComponent }>('../app/pages/**/*.tsx');

createInertiaApp({
  title: (title) => title || 'シラバスアルプス',
  resolve: async (name) => {
    const load = pages[`../app/pages/${name}.tsx`];
    if (!load) throw new Error(`Inertia page not found: ${name}`);
    return (await load()).default;
  },
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />);
  },
  progress: { color: '#27272a' },
});
