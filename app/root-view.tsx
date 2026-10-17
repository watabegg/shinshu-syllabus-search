import { Link, Script, ViteClient } from 'vite-ssr-components/react';
import { serializePage, type PageObject, type RootView } from '@hono/inertia';
import { renderToString } from 'react-dom/server';

import { pageMetadata } from '../src/lib/seo';
import { seoElements } from './seo-elements';

function Document({ page }: { page: PageObject }) {
  const meta = pageMetadata(page);
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#fafafa" />
        <title {...{ inertia: 'title' }}>{meta.title}</title>
        {seoElements(meta, true)}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <ViteClient />
        <Link href="/src/style.css" rel="stylesheet" />
        <Script src="/src/client.tsx" />
      </head>
      <body>
        <script data-page="app" type="application/json" dangerouslySetInnerHTML={{ __html: serializePage(page) }} />
        <div id="app" />
      </body>
    </html>
  );
}

export const rootView: RootView = (page) => `<!DOCTYPE html>${renderToString(<Document page={page} />)}`;
