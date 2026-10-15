import { Form, Head, Link } from '@inertiajs/react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
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

function detailHref(currentUrl: string, id: string): string {
  const url = new URL(currentUrl, window.location.origin);
  const back = `${url.pathname}${url.search}`;
  return `/courses/${encodeURIComponent(id)}?back=${encodeURIComponent(back)}`;
}

function SearchForm({ props }: { props: SearchProps }) {
  const { filters, availableFilters } = props;
  return (
    <Form action="/" method="get" className="search-form" aria-label="講義を検索">
      <div className="filter-grid">
        <label className="field field-keyword">
          <span>キーワード</span>
          <Input name="q" defaultValue={filters.q} maxLength={200} placeholder="科目名・担当教員・登録コード・本文" autoComplete="off" />
          <small>1〜5語・各40文字以内。2文字以下も検索できます。</small>
        </label>
        <label className="field">
          <span>科目名</span>
          <Input name="title" defaultValue={filters.title} maxLength={100} placeholder="科目名を含む" />
        </label>
        <label className="field">
          <span>担当教員</span>
          <Input name="teacher" defaultValue={filters.teacher} maxLength={100} placeholder="教員名を含む" />
        </label>
        <label className="field">
          <span>教室</span>
          <Input name="room" defaultValue={filters.room} maxLength={100} placeholder="教室・会場を含む" />
        </label>
        <label className="field">
          <span>年度</span>
          <Select name="year" defaultValue={filters.year}>
            {availableFilters.years.map((year) => <option key={year} value={year}>{year}年度</option>)}
          </Select>
        </label>
        <label className="field">
          <span>学部・研究科</span>
          <Select name="department" defaultValue={filters.department}>
            <option value="">すべて</option>
            {availableFilters.departments.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </Select>
        </label>
        <label className="field">
          <span>学期</span>
          <Select name="term" defaultValue={filters.term}>
            <option value="">すべて</option>
            {availableFilters.terms.map((term) => <option key={term} value={term}>{term}</option>)}
          </Select>
        </label>
        <label className="field">
          <span>曜日</span>
          <Select name="day" defaultValue={filters.day}>
            <option value="">すべて</option>
            {['月', '火', '水', '木', '金', '土', '日'].map((day, index) => <option key={day} value={index + 1}>{day}曜日</option>)}
          </Select>
        </label>
        <label className="field">
          <span>時限</span>
          <Select name="period" defaultValue={filters.period}>
            <option value="">すべて</option>
            {Array.from({ length: 10 }, (_, index) => index + 1).map((period) => <option key={period} value={period}>{period}限</option>)}
          </Select>
        </label>
        <label className="field">
          <span>授業形式</span>
          <Select name="modality" defaultValue={filters.modality}>
            <option value="">すべて</option>
            {Object.entries(modalityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </label>
      </div>
      <div className="form-actions">
        <Button type="submit">検索する</Button>
        <Link href="/" className={buttonVariants({ variant: 'outline' })}>条件をクリア</Link>
      </div>
    </Form>
  );
}

function ResultCard({ course, currentUrl }: { course: CourseSummary; currentUrl: string }) {
  const slots = course.slots.map(slotLabel).filter(Boolean);
  return (
    <article className="result-card">
      <div className="result-card-heading">
        <h2><Link href={detailHref(currentUrl, course.id)}>{course.title || '科目名未登録'}</Link></h2>
        <Modalities items={course.modalities} />
      </div>
      <dl className="result-meta">
        <div><dt>担当教員</dt><dd>{course.teacher_text || '記載なし'}</dd></div>
        <div><dt>登録コード</dt><dd>{course.registration_code}</dd></div>
        <div><dt>年度</dt><dd>{course.year}年度</dd></div>
        <div><dt>部局</dt><dd>{course.department_name}</dd></div>
        <div><dt>単位</dt><dd>{course.credits || '記載なし'}</dd></div>
        <div><dt>教室</dt><dd>{course.room_text || '記載なし'}</dd></div>
        <div className="result-meta-wide"><dt>開講日時</dt><dd>{slots.length > 0 ? slots.join(' / ') : '記載なし'}</dd></div>
      </dl>
    </article>
  );
}

function CoverageNote({ props }: { props: SearchProps }) {
  const { coverage, importedAt } = props;
  const date = importedAt ? importedAt.replace('T', ' ').replace(/Z$/u, ' UTC') : null;
  return (
    <aside className="coverage-note" aria-label="データの対象と取得状況">
      <div><strong>対象データ</strong><span>{props.filters.year || '全年度'}年度</span></div>
      <div><strong>登録状況</strong><span>{coverage.ready.toLocaleString('ja-JP')} / {coverage.discovered.toLocaleString('ja-JP')} 件</span></div>
      <div><strong>取得日時</strong><span>{date ?? 'まだ取り込みがありません'}</span></div>
      {(coverage.failed > 0 || coverage.conflict > 0) && (
        <p>未掲載の可能性がある資料があります（取得失敗 {coverage.failed} 件・重複確認 {coverage.conflict} 件）。</p>
      )}
    </aside>
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
          <p>信州大学 公開シラバス検索</p>
        </header>
        <main id="main-content" className="page-main">
          <div className="page-intro">
            <p className="eyebrow">SHINSHU UNIVERSITY · SYLLABUS</p>
            <h1>シラバスを検索</h1>
            <p>科目名・担当教員・登録コード・本文や時間割から講義を探せます。</p>
          </div>
          <Card className="panel search-panel" aria-labelledby="search-heading">
            <div className="panel-heading">
              <div><p className="section-kicker">SEARCH</p><h2 id="search-heading">検索条件</h2></div>
              <p className="panel-description">条件を複数指定すると、すべてに一致する講義を表示します。</p>
            </div>
            <SearchForm props={props} />
          </Card>

          <div className="results-layout">
            <section className="results-section" aria-labelledby="results-heading">
              <div className="results-heading">
                <div><p className="section-kicker">RESULTS</p><h2 id="results-heading">検索結果</h2></div>
                {!databaseEmpty && <p className="result-count">このページに <strong>{shownCount}</strong> 件表示 <span>· {props.filters.page}ページ目</span></p>}
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
              {!databaseEmpty && shownCount > 0 && (props.hasNext || props.filters.page > 1) && (
                <nav className="pagination" aria-label="検索結果のページ">
                  {props.filters.page > 1 ? <Link className={buttonVariants({ variant: 'outline' })} href={pageHref(currentUrl, props.filters.page - 1)}>前の20件</Link> : <span />}
                  <span className="page-indicator">{props.filters.page}ページ目</span>
                  {props.hasNext ? <Link className={buttonVariants({ variant: 'outline' })} href={pageHref(currentUrl, props.filters.page + 1)}>次の20件</Link> : <span />}
                </nav>
              )}
            </section>
            <aside className="results-aside">
              <CoverageNote props={props} />
              <div className="aside-note">
                <strong>出典について</strong>
                <p>このサイトは信州大学の公式サービスではありません。講義の詳細ページから、公開されている原本PDFを確認できます。</p>
              </div>
            </aside>
          </div>
        </main>
        <footer className="site-footer"><span>信州大学シラバス検索 · 非公式</span><span>掲載内容は大学の公開資料をもとにしています。</span></footer>
      </div>
    </>
  );
}
