import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Form, Head, Link, router } from '@inertiajs/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { modalityLabels } from '@/lib/contracts';
import type { CourseSummary, SearchProps } from '@/lib/contracts';

function slotLabel(slot: CourseSummary['slots'][number]): string {
  return [slot.term_label, slot.day_label, slot.period_label].filter(Boolean).join(' · ');
}

function Modalities({ items }: { items: CourseSummary['modalities'] }) {
  if (items.length === 0) return null;
  return (
    <span className="tag-list" aria-label="授業形式">
      {items.map((item) => <Badge variant="outline" key={item}>{modalityLabels[item]}</Badge>)}
    </span>
  );
}

function pageHref(currentUrl: string, page: number): string {
  const url = new URL(currentUrl, window.location.origin);
  url.searchParams.set('page', String(page));
  return `${url.pathname}${url.search}`;
}

function ResultPagination({ currentUrl, page, totalPages }: { currentUrl: string; page: number; totalPages: number }) {
  return (
    <nav className="pagination" aria-label="検索結果のページ">
      <Button variant="outline" size="icon" className="size-11 rounded-xl" disabled={page <= 1}
        aria-label="前のページ" onClick={() => router.get(pageHref(currentUrl, page - 1))}>
        <ChevronLeft className="size-5" aria-hidden="true" />
      </Button>
      <Select value={String(page)} onValueChange={(value) => router.get(pageHref(currentUrl, Number(value)))}>
        <SelectTrigger aria-label="ページを選択" className="h-11! w-32 rounded-xl bg-card px-4 text-base tabular-nums">
          <SelectValue>{page}/{totalPages}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="center">
          {Array.from({ length: totalPages }, (_, index) => index + 1).map((value) => (
            <SelectItem key={value} value={String(value)}>{value}/{totalPages}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="icon" className="size-11 rounded-xl" disabled={page >= totalPages}
        aria-label="次のページ" onClick={() => router.get(pageHref(currentUrl, page + 1))}>
        <ChevronRight className="size-5" aria-hidden="true" />
      </Button>
    </nav>
  );
}

function detailHref(currentUrl: string, id: string): string {
  const url = new URL(currentUrl, window.location.origin);
  const back = `${url.pathname}${url.search}`;
  return `/courses/${encodeURIComponent(id)}?back=${encodeURIComponent(back)}`;
}

function SearchSelect({ name, label, initialValue, options, allowAll = true }: {
  name: string; label: string; initialValue: string;
  options: { value: string; label: string }[]; allowAll?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <div className="field">
      <Label htmlFor={`filter-${name}`}>{label}</Label>
      <input type="hidden" name={name} value={value} />
      <Select value={value || '__all__'} onValueChange={(next) => setValue(next === '__all__' ? '' : next)}>
        <SelectTrigger id={`filter-${name}`} className="w-full bg-card font-normal">
          <SelectValue placeholder="すべて" />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {allowAll && <SelectItem value="__all__">すべて</SelectItem>}
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function SearchForm({ props }: { props: SearchProps }) {
  const { filters, availableFilters } = props;
  return (
    <Form action="/" method="get" className="search-form" aria-label="講義を検索">
      <div className="filter-grid">
        <div className="field field-keyword">
          <Label htmlFor="filter-q">キーワード</Label>
          <Input id="filter-q" name="q" defaultValue={filters.q} maxLength={200} placeholder="科目名・担当教員・登録コード・本文" autoComplete="off" />
        </div>
        <div className="field">
          <Label htmlFor="filter-title">科目名</Label>
          <Input id="filter-title" name="title" defaultValue={filters.title} maxLength={100} placeholder="科目名を含む" />
        </div>
        <div className="field">
          <Label htmlFor="filter-teacher">担当教員</Label>
          <Input id="filter-teacher" name="teacher" defaultValue={filters.teacher} maxLength={100} placeholder="教員名を含む" />
        </div>
        <div className="field">
          <Label htmlFor="filter-room">教室</Label>
          <Input id="filter-room" name="room" defaultValue={filters.room} maxLength={100} placeholder="教室・会場を含む" />
        </div>
        <SearchSelect name="year" label="年度" initialValue={filters.year} allowAll={false}
          options={availableFilters.years.map((year) => ({ value: String(year), label: `${year}年度` }))} />
        <SearchSelect name="department" label="学部・研究科" initialValue={filters.department}
          options={availableFilters.departments.map(({ id, name }) => ({ value: id, label: name }))} />
        <SearchSelect name="term" label="学期" initialValue={filters.term}
          options={availableFilters.terms.map((term) => ({ value: term, label: term }))} />
        <SearchSelect name="day" label="曜日" initialValue={filters.day}
          options={['月', '火', '水', '木', '金', '土', '日'].map((day, index) => ({ value: String(index + 1), label: `${day}曜日` }))} />
        <SearchSelect name="period" label="時限" initialValue={filters.period}
          options={Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: `${index + 1}限` }))} />
        <SearchSelect name="modality" label="授業形式" initialValue={filters.modality}
          options={Object.entries(modalityLabels).filter(([value]) => value !== 'unknown').map(([value, label]) => ({ value, label }))} />
      </div>
      <div className="form-actions">
        <Button type="submit">検索する</Button>
        <Button variant="outline" asChild><Link href="/">条件をクリア</Link></Button>
      </div>
    </Form>
  );
}

function ResultCard({ course, currentUrl }: { course: CourseSummary; currentUrl: string }) {
  const slots = course.slots.map(slotLabel).filter(Boolean);
  return (
    <Link href={detailHref(currentUrl, course.id)} aria-labelledby={`title-${course.id}`} className="result-card-link">
    <Card className="h-full gap-3 py-5" role="article">
      <CardHeader>
      <div className="result-card-heading">
        <CardTitle><h2 id={`title-${course.id}`} className="text-base leading-relaxed">{course.title || '科目名未登録'}</h2></CardTitle>
        <Modalities items={course.modalities} />
      </div>
      </CardHeader>
      <CardContent>
      <dl className="result-meta">
        <div><dt>担当教員</dt><dd>{course.teacher_text || '記載なし'}</dd></div>
        <div><dt>登録コード</dt><dd>{course.registration_code}</dd></div>
        <div><dt>年度</dt><dd>{course.year}年度</dd></div>
        <div><dt>部局</dt><dd>{course.department_name}</dd></div>
        <div><dt>単位</dt><dd>{course.credits || '記載なし'}</dd></div>
        <div><dt>教室</dt><dd>{course.room_text || '記載なし'}</dd></div>
        <div className="result-meta-wide"><dt>開講日時</dt><dd>{slots.length > 0 ? slots.join(' / ') : '記載なし'}</dd></div>
      </dl>
      </CardContent>
    </Card>
    </Link>
  );
}

export default function Index(props: SearchProps) {
  const currentUrl = typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`;
  const databaseEmpty = props.coverage.ready === 0;
  const shownCount = props.items.length;
  return (
    <>
      <Head title="シラバスを検索" />
      <a className="skip-link" href="#main-content">本文へ移動</a>
      <div className="site-shell">
        <header className="site-header">
          <Link href="/" className="brand-link"><span className="brand-mark" aria-hidden="true">信</span><span>シラバス検索</span><Badge variant="outline">非公式</Badge></Link>
        </header>
        <main id="main-content" className="page-main">
          <Card className="gap-5" aria-labelledby="search-heading">
            <CardHeader className="gap-2">
              <div><CardTitle><h1 id="search-heading">検索条件</h1></CardTitle></div>
              <CardDescription>条件を複数指定すると、すべてに一致する講義を表示します。</CardDescription>
            </CardHeader>
            <CardContent><SearchForm key={JSON.stringify(props.filters)} props={props} /></CardContent>
          </Card>

          <div className="results-layout">
            <section className="results-section" aria-labelledby="results-heading">
              <div className="results-heading">
                <h2 id="results-heading">検索結果 <span className="result-count">{props.total.toLocaleString('ja-JP')}件</span></h2>
                {props.totalPages > 1 && <ResultPagination currentUrl={currentUrl} page={props.filters.page} totalPages={props.totalPages} />}
              </div>
              {databaseEmpty ? (
                <div className="empty-state" role="status">
                  <span className="empty-icon" aria-hidden="true">⌕</span>
                  <h3>検索データを準備しています</h3>
                  <p>現在、公開シラバスのデータはまだ登録されていません。</p>
                </div>
              ) : shownCount === 0 ? (
                <div className="empty-state" role="status">
                  <span className="empty-icon" aria-hidden="true">⌕</span>
                  <h3>条件に合う講義が見つかりませんでした</h3>
                  <p>キーワードを短くするか、検索条件を広げてもう一度お試しください。</p>
                </div>
              ) : (
                <div className="result-list">
                  {props.items.map((course) => <ResultCard key={course.id} course={course} currentUrl={currentUrl} />)}
                </div>
              )}
            </section>

          </div>
        </main>
        <footer className="site-footer"><span>信州大学シラバス検索 · 非公式</span><span>掲載内容は大学の公開資料をもとにしています。</span></footer>
      </div>
    </>
  );
}
