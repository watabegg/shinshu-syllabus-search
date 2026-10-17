import { PageHead } from '../page-head';
import { useState } from 'react';
import { SearchMultiSelect } from '@/components/search-multi-select';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Form, Link, router } from '@inertiajs/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { modalityLabels } from '@/lib/contracts';
import { CourseResults } from '@/components/course-results';
import type { SearchProps } from '@/lib/contracts';

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
        <SearchMultiSelect label="学部・研究科" groups={[{ name: 'department', label: '学部・研究科', initialValue: filters.department,
          options: availableFilters.departments.map(({ id, name }) => ({ value: id, label: name })) }]} />
      </div>
      <div className="multi-filter-grid">
        <SearchMultiSelect label="学期" groups={[
          { name: 'term', label: '開講学期', initialValue: filters.term, options: ['前期', '後期', '通年'].map(value => ({ value, label: value })) },
          { name: 'intensive', label: '集中授業', initialValue: filters.intensive, options: [{ value: 'yes', label: '集中' }, { value: 'no', label: '集中以外' }] },
        ]} />
        <SearchMultiSelect label="曜日" groups={[{ name: 'day', label: '曜日', initialValue: filters.day,
          options: ['月', '火', '水', '木', '金', '土', '日'].map((label, index) => ({ value: String(index + 1), label })) }]} />
        <SearchMultiSelect label="時限" groups={[{ name: 'period', label: '時限', initialValue: filters.period,
          options: Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: `${index + 1}限` })) }]} />
        <SearchMultiSelect label="授業形式" groups={[{ name: 'modality', label: '授業形式', initialValue: filters.modality,
          options: Object.entries(modalityLabels).filter(([value]) => value !== 'unknown').map(([value, label]) => ({ value, label })) }]} />
      </div>
      <div className="form-actions">
        <Button type="submit">検索する</Button>
        <Button variant="outline" asChild><Link href="/">条件をクリア</Link></Button>
      </div>
    </Form>
  );
}

export default function Index(props: SearchProps) {
  const currentUrl = typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`;
  return (
    <>
      <PageHead />
      <a className="skip-link" href="#main-content">本文へ移動</a>
      <div className="site-shell">
        <header className="site-header">
          <Link href="/" className="brand-link"><span className="brand-mark" aria-hidden="true">信</span><span>シラバスアルプス</span><Badge variant="outline">非公式</Badge></Link>
        </header>
        <main id="main-content" className="page-main search-main">
          <Card className="gap-5 search-panel" aria-labelledby="search-heading">
            <CardHeader className="gap-2">
              <div><CardTitle><h1 id="search-heading">検索条件</h1></CardTitle></div>
              <CardDescription>条件を複数指定すると、すべてに一致する講義を表示します。</CardDescription>
            </CardHeader>
            <CardContent><SearchForm key={JSON.stringify(props.filters)} props={props} /></CardContent>
          </Card>

          <div className="results-layout">
            <CourseResults key={currentUrl} props={props} currentUrl={currentUrl} pagination={props.totalPages > 1 ? <ResultPagination currentUrl={currentUrl} page={props.filters.page} totalPages={props.totalPages} /> : null} />

          </div>
        </main>
        <footer className="site-footer"><span>シラバスアルプス · 非公式</span><span>掲載内容は大学の公開資料をもとにしています。</span></footer>
      </div>
    </>
  );
}
