import { Head, usePage } from '@inertiajs/react';
import { pageMetadata } from '../src/lib/seo';
import { seoElements } from './seo-elements';

export function PageHead() {
  const page = usePage();
  const meta = pageMetadata(page);
  return <Head title={meta.title}>{seoElements(meta)}</Head>;
}
