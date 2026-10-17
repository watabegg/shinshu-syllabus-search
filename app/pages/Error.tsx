import { PageHead } from '../page-head';
import { Link } from '@inertiajs/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';

export type ErrorPageProps = { status: number; message: string };

export default function ErrorPage({ status, message }: ErrorPageProps) {
  const heading = status === 404 ? 'ページが見つかりません' : status === 503 ? 'サービスを一時的に利用できません' : '入力内容を確認してください';
  return (
    <>
      <PageHead />
      <div className="site-shell">
        <header className="site-header"><Link href="/" className="brand-link"><span className="brand-mark" aria-hidden="true">信</span><span>シラバスアルプス</span><Badge variant="outline">非公式</Badge></Link></header>
        <main className="page-main error-main">
          <Card className="w-full" role="alert"><CardHeader>
            <CardTitle><h1 className="text-2xl">{heading}</h1></CardTitle>
            <CardDescription>{message}</CardDescription></CardHeader><CardFooter>
            <Button asChild><Link href="/">検索ページに戻る</Link></Button></CardFooter>
          </Card>
        </main>
        <footer className="site-footer"><span>シラバスアルプス · 非公式</span></footer>
      </div>
    </>
  );
}
