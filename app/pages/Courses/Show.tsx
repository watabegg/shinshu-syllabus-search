import { Head, Link } from '@inertiajs/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { SyllabusBody } from '@/components/syllabus-body';
import { Separator } from '@/components/ui/separator';
import { ChevronDown, ExternalLink } from 'lucide-react';
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

function publicWarning(warning: string): string {
  if (warning.startsWith('source URL is absent from the latest index')) return '現在の公開一覧にこの資料が見当たらないため、前回取得した内容を表示しています。最新の案内をご確認ください。';
  if (warning.startsWith('HTML/PDF schedule differs:')) return '一覧とPDFで時間割の記載が異なります。原本PDFをご確認ください。';
  if (warning.startsWith('ambiguous delivery-format statement')) return '授業形式を本文から特定できませんでした。原本PDFをご確認ください。';
  if (warning === 'no schedule slot was found in PDF or department HTML') return '時間割の記載を確認できませんでした。原本PDFをご確認ください。';
  if (warning === 'extracted text contains Unicode replacement characters') return '本文に読み取れない文字が含まれている可能性があります。原本PDFをご確認ください。';
  if (warning.startsWith('pdftotext:')) return 'PDF本文の読み取りに一部問題がありました。原本PDFをご確認ください。';
  if (warning === 'registration code not found in PDF header') return 'PDF内で登録コードを確認できませんでした。';
  if (warning === 'opening year not found in PDF header') return 'PDF内で開講年度を確認できませんでした。';
  if (warning === 'course title not found in PDF header') return 'PDF内で科目名を確認できませんでした。';
  if (warning === 'teacher fields were not found in PDF header') return 'PDF内で担当教員を確認できませんでした。';
  if (warning === 'classroom field was not found in PDF header') return 'PDF内で教室を確認できませんでした。';
  if (warning.startsWith('PDF registration code ')) return '一覧とPDFで登録コードが異なる可能性があります。';
  if (warning === 'PDF title differs from the title shown in the department index') return '一覧とPDFで科目名の表記が異なります。';
  return '一部の情報を十分に読み取れなかった可能性があります。原本PDFをご確認ください。';
}

function evidenceSourceLabel(source: string): string {
  if (source.startsWith('pdf:')) return 'PDF本文';
  return '公開資料';
}

export default function Show(props: DetailProps) {
  const { course } = props;
  const backHref = typeof window === 'undefined' ? '/' : safeBackHref();
  return (
    <>
      <Head title={course.title || '講義詳細'} />
      <a className="skip-link" href="#main-content">本文へ移動</a>
      <div className="site-shell">
        <header className="site-header">
          <Link href="/" className="brand-link"><span className="brand-mark" aria-hidden="true">信</span><span>シラバス検索</span><Badge variant="outline">非公式</Badge></Link>
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
              {props.modalityEvidence.length > 0 && <ul className="evidence-list">{props.modalityEvidence.map((evidence, index) => <li key={`${evidence.modality}-${index}`}><strong>{evidence.modality === 'unknown' ? '原文の記載' : modalityLabels[evidence.modality]}</strong>：{evidence.text} <span>（{evidenceSourceLabel(evidence.source)}）</span></li>)}</ul>}
            </div>
            <div className="detail-block">
              <h2>シラバス本文</h2>
              <SyllabusBody sections={props.sections} pages={props.pages} />
            </div>
            {props.parseWarnings.length > 0 && (
              <Alert className="mt-4 border-amber-200 bg-amber-50" aria-labelledby="warning-heading">
                <AlertTitle><h2 id="warning-heading">抽出時の注意</h2></AlertTitle><AlertDescription>
                <ul>{props.parseWarnings.map((warning, index) => <li key={`${warning}-${index}`}>{publicWarning(warning)}</li>)}</ul>
              </AlertDescription></Alert>
            )}
            <Separator className="mt-4" /><div className="source-panel">
              <h2>出典と取得情報</h2>
              <dl className="detail-meta source-meta">
                <div><dt>取得日</dt><dd>{formatDate(props.fetchedAt)}</dd></div>
                <div><dt>出典ページ</dt><dd>{props.pages.length > 0 ? `${props.pages[0]?.page_number}–${props.pages.at(-1)?.page_number}ページ` : '記録なし'}</dd></div>
              </dl>
              {props.sourceUrl ? <Button asChild><a href={props.sourceUrl} target="_blank" rel="noreferrer noopener">大学の原本PDFを開く <ExternalLink aria-hidden="true" /></a></Button> : <p className="muted">原本PDFへのリンクを確認できません。</p>}
              <p className="source-caveat">本文は公開PDFから抽出したテキストです。表や文字の読み取りに誤り・欠落がある場合は、原本PDFをご確認ください。</p>
              {props.sourceSha256 && <Collapsible className="technical-details"><CollapsibleTrigger asChild><Button variant="ghost" size="sm">資料の照合情報<ChevronDown aria-hidden="true" /></Button></CollapsibleTrigger><CollapsibleContent><dl><div><dt>PDF識別用ハッシュ</dt><dd><code>{props.sourceSha256}</code></dd></div></dl></CollapsibleContent></Collapsible>}
            </div>
          </CardContent></Card>
        </main>
        <footer className="site-footer"><span>信州大学シラバス検索 · 非公式</span><span>大学の公式サービスではありません。</span></footer>
      </div>
    </>
  );
}
