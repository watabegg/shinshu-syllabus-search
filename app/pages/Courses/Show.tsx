import { PageHead } from '../../page-head';
import { Link } from '@inertiajs/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { SyllabusBody } from '@/components/syllabus-body';
import { Separator } from '@/components/ui/separator';
import { ExternalLink } from 'lucide-react';
import type { DetailProps, Slot } from '@/lib/contracts';
import { modalityLabels } from '@/lib/contracts';

function slotLabel(slot: Slot): string {
  return [slot.term_label, slot.day_label, slot.period_label].filter(Boolean).join(' · ');
}

function safeBackHref(): string {
  const encoded = new URLSearchParams(window.location.search).get('back');
  if (!encoded) return '/';
  try {
    const target = new URL(encoded, window.location.origin);
    if (target.origin === window.location.origin && target.pathname === '/') return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    // A malformed history link falls back to the public search page.
  }
  return '/';
}

function formatDate(value: string): string {
  if (!value) return '記録なし';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ja-JP', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(date);
}

export default function Show(props: DetailProps) {
  const { course } = props;
  const backHref = typeof window === 'undefined' ? '/' : safeBackHref();
  return (
    <>
      <PageHead />
      <a className="skip-link" href="#main-content">本文へ移動</a>
      <div className="site-shell">
        <header className="site-header">
          <Link href="/" className="brand-link"><span className="brand-mark" aria-hidden="true">信</span><span>シラバスアルプス</span><Badge variant="outline">非公式</Badge></Link>
          <p>{course.year}年度 公開シラバス</p>
        </header>
        <main id="main-content" className="page-main detail-main">
          <nav className="breadcrumb" aria-label="パンくずリスト"><Link href={backHref}>← 検索結果に戻る</Link></nav>
          <Card className="gap-4">
            <CardHeader>
            <CardTitle><h1 className="text-2xl leading-relaxed">{course.title || '科目名未登録'}</h1></CardTitle>
            </CardHeader><CardContent>
            <dl className="detail-meta">
              <div><dt>担当教員</dt><dd>{course.teacher_text || '記載なし'}</dd></div>
              <div><dt>登録コード</dt><dd>{course.registration_code}</dd></div>
              <div><dt>年度</dt><dd>{course.year}年度</dd></div>
              <div><dt>学部・研究科</dt><dd>{course.department_name}</dd></div>
              <div><dt>単位</dt><dd>{course.credits || '記載なし'}</dd></div>
              <div><dt>教室</dt><dd>{course.room_text || '記載なし'}</dd></div>
            </dl>
            <div className="detail-block">
              <h2>開講日時</h2>
              {course.slots.length > 0 ? <ul className="plain-list">{course.slots.map((slot, index) => <li key={`${slotLabel(slot)}-${index}`}>{slotLabel(slot) || '日時の記載なし'}</li>)}</ul> : <p className="muted">時間割の記載はありません。</p>}
            </div>
            <div className="detail-block">
              <h2>授業形式</h2>
              {course.modalities.length > 0 ? (
                <ul className="plain-list">{course.modalities.map((modality) => <li key={modality}>{modalityLabels[modality]}</li>)}</ul>
              ) : <p className="muted">授業形式の記載はありません。</p>}

            </div>
            <div className="detail-block">
              <h2>シラバス本文</h2>
              <SyllabusBody sections={props.sections} pages={props.pages} />
            </div>
            <Separator className="mt-4" /><div className="source-panel">
              <h2>出典と取得情報</h2>
              <dl className="detail-meta source-meta">
                <div><dt>取得日</dt><dd>{formatDate(props.fetchedAt)}</dd></div>
                <div><dt>出典ページ</dt><dd>{props.pages.length > 0 ? `${props.pages[0]?.page_number}–${props.pages.at(-1)?.page_number}ページ` : '記録なし'}</dd></div>
              </dl>
              {props.sourceUrl ? <Button asChild><a href={props.sourceUrl} target="_blank" rel="noreferrer noopener">大学の原本PDFを開く <ExternalLink aria-hidden="true" /></a></Button> : <p className="muted">原本PDFへのリンクを確認できません。</p>}
            </div>
          </CardContent></Card>
        </main>
        <footer className="site-footer"><span>シラバスアルプス · 非公式</span><span>大学の公式サービスではありません。</span></footer>
      </div>
    </>
  );
}
