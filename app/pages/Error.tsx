import { Head, Link } from '@inertiajs/react';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

export type ErrorPageProps = { status: number; message: string };

export default function ErrorPage({ status, message }: ErrorPageProps) {
  const heading = status === 404 ? 'ページが見つかりません' : status === 503 ? 'サービスを一時的に利用できません' : '入力内容を確認してください';
  return (
    <>
      <Head title={heading} />
      <div className="site-shell">
        <header className="site-header"><Link href="/" className="brand-link"><span className="brand-mark" aria-hidden="true">信</span><span>シラバス検索</span><Badge variant="outline">非公式</Badge></Link></header>
        <main className="page-main error-main">
          <Card className="panel error-panel" role="alert">
            <p className="section-kicker">ERROR {status}</p>
            <h1>{heading}</h1>
            <p>{message}</p>
            <Link className={buttonVariants()} href="/">検索ページに戻る</Link>
          </Card>
        </main>
        <footer className="site-footer"><span>信州大学シラバス検索 · 非公式</span></footer>
      </div>
    </>
  );
}
