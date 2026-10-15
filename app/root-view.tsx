import { Link, Script, ViteClient } from 'vite-ssr-components/react';
import { serializePage, type PageObject, type RootView } from '@hono/inertia';
import { renderToString } from 'react-dom/server';

function Document({ page }: { page: PageObject }) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#fafafa" />
        <title>信州大学シラバス検索（非公式）</title>
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
