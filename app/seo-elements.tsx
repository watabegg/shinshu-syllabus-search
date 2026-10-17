import { SITE_NAME, SITE_ORIGIN, type pageMetadata } from '../src/lib/seo';

export function seoElements(meta: ReturnType<typeof pageMetadata>, server = false) {
  const values = [
    { name: 'description', content: meta.description },
    { name: 'robots', content: meta.robots },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: SITE_NAME },
    { property: 'og:locale', content: 'ja_JP' },
    { property: 'og:title', content: meta.title },
    { property: 'og:description', content: meta.description },
    { property: 'og:url', content: meta.canonical },
    { property: 'og:image', content: `${SITE_ORIGIN}/og-syllabus-alps.png?v=2` },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: 'シラバスアルプス — 信州大学のシラバス検索（非公式）' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: meta.title },
    { name: 'twitter:description', content: meta.description },
    { name: 'twitter:image', content: `${SITE_ORIGIN}/og-syllabus-alps.png?v=2` },
  ];
  return [
    ...values.map(value => {
      const key = value.name ?? value.property;
      return <meta key={key} {...(server ? { inertia: key } : { 'head-key': key })} {...value} />;
    }),
    <link key="canonical" {...(server ? { inertia: 'canonical' } : { 'head-key': 'canonical' })} rel="canonical" href={meta.canonical} />,
  ];
}
