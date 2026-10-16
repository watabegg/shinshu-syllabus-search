import { useEffect, useState } from 'react';
import { Link } from '@inertiajs/react';
import { Star, Bookmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { modalityLabels, type CourseSummary, type SearchProps } from '@/lib/contracts';
import { decodeLibrary, emptyLibrary, LIBRARY_KEY, type LocalLibrary } from '@/lib/local-library';

type View = 'search' | 'favorites';
export function CourseResults({ props, currentUrl, pagination }: { props: SearchProps; currentUrl: string; pagination: React.ReactNode }) {
  const url = new URL(currentUrl, 'https://local.invalid');
  const view = getView(url.searchParams.get('view'));
  const { library, ready, message, persist } = useLocalLibrary();
  const [selected, setSelected] = useState<string[]>([]);
  const save = (change: (current: LocalLibrary) => LocalLibrary, success: string) => {
    if (persist(change, success)) setSelected([]);
  };
  const items = getItems(view, library, props);
  const selectedIds = new Set(selected);
  const picked = items.filter(course => selectedIds.has(course.id));
  const favoriteIds = new Set(library.favorites.map(course => course.id));
  const title = viewTitles[view];
  const tabHref = (next: View) => { const target = new URL(currentUrl, 'https://local.invalid'); if (next === 'search') target.searchParams.delete('view'); else target.searchParams.set('view', next); return target.pathname + target.search; };
  const toggleFavorite = (course: CourseSummary) => save(current => ({ ...current, favorites: current.favorites.some(item => item.id === course.id) ? current.favorites.filter(item => item.id !== course.id) : [...current.favorites, course] }), favoriteIds.has(course.id) ? 'お気に入りから解除しました。' : 'お気に入りに追加しました。');
  const count = view === 'search' ? props.total : items.length;
  return <section className="results-section" aria-labelledby="results-heading">
    <div className="library-topbar">
      <nav className="library-tabs" aria-label="講義一覧の表示">
        {(['search', 'favorites'] as const).map(next => <Button key={next} variant={view === next ? 'secondary' : 'ghost'} asChild><Link href={tabHref(next)} aria-current={view === next ? 'page' : undefined}>{next === 'search' ? '検索結果' : `お気に入り${ready ? ` (${library.favorites.length})` : ''}`}</Link></Button>)}
      </nav>
      <SavedConditionMenu ready={ready} library={library} props={props} save={save} />
    </div>
    <div className="results-heading"><h2 id="results-heading">{title} <span className="result-count">{count.toLocaleString('ja-JP')}件</span></h2>{view === 'search' && pagination}</div>
    <LibraryToolbar ready={ready} picked={picked} selectedIds={selectedIds} favoriteIds={favoriteIds} save={save} clear={() => setSelected([])} />
    <p role="status" className={message.includes("ません") ? "library-message" : "sr-only"}>{message}</p>
    {!ready && view !== 'search' ? <p>保存データを読み込んでいます。</p> : items.length === 0 ? <EmptyResults view={view} databaseReady={props.coverage.ready > 0} /> :
    <CourseTable items={items} title={title} selectedIds={selectedIds} selectedCount={picked.length} favoriteIds={favoriteIds} ready={ready} currentUrl={currentUrl} onSelect={setSelected} onFavorite={toggleFavorite} />}

  </section>;
}

function CourseTable({ items, title, selectedIds, selectedCount, favoriteIds, ready, currentUrl, onSelect, onFavorite }: {
  items: CourseSummary[]; title: string; selectedIds: Set<string>; selectedCount: number; favoriteIds: Set<string>; ready: boolean; currentUrl: string;
  onSelect: React.Dispatch<React.SetStateAction<string[]>>; onFavorite: (course: CourseSummary) => void;
}) {
  return (
    <div className="course-table"><Table aria-label={title}>
      <TableHeader><TableRow><TableHead><Checkbox aria-label="表示中の講義をすべて選択" checked={selectedCount === items.length ? true : selectedCount ? 'indeterminate' : false} onCheckedChange={checked => onSelect(checked === true ? items.map(item => item.id) : [])} /></TableHead><TableHead><Star className="size-4" aria-label="お気に入り" /></TableHead><TableHead>科目名 / 登録コード</TableHead><TableHead>担当教員</TableHead><TableHead>開講日時</TableHead><TableHead>教室</TableHead><TableHead>授業形式</TableHead><TableHead>学部・研究科</TableHead><TableHead>単位</TableHead></TableRow></TableHeader>
      <TableBody>{items.map(course => <TableRow key={course.id} data-state={selectedIds.has(course.id) ? 'selected' : undefined}>
        <TableCell><Checkbox aria-label={`${course.title}（${course.registration_code}）を選択`} checked={selectedIds.has(course.id)} onCheckedChange={checked => onSelect(current => checked === true ? [...current, course.id] : current.filter(id => id !== course.id))} /></TableCell>
        <TableCell><Button variant="ghost" size="icon" disabled={!ready} aria-label={`${course.title}をお気に入り${favoriteIds.has(course.id) ? 'から解除' : 'に追加'}`} aria-pressed={favoriteIds.has(course.id)} onClick={() => onFavorite(course)}><Star className={favoriteIds.has(course.id) ? 'fill-amber-400 text-amber-600' : ''} /></Button></TableCell>
        <TableCell><Link className="course-title-link" href={`/courses/${encodeURIComponent(course.id)}?back=${encodeURIComponent(currentUrl)}`}>{course.title || '科目名未登録'}</Link><div className="course-subtitle">{course.registration_code} · {course.year}年度</div></TableCell>
        <TableCell>{course.teacher_text || '記載なし'}</TableCell><TableCell>{course.slots.length ? course.slots.map(slot => <div key={`${slot.term_label}-${slot.day_label}-${slot.period_label}-${slot.source_kind}`}>{[slot.term_label, slot.day_label, slot.period_label].filter(Boolean).join(' · ')}</div>) : '記載なし'}</TableCell><TableCell>{course.room_text || '記載なし'}</TableCell><TableCell>{course.modalities.map(m => <div key={m}>{modalityLabels[m]}</div>)}</TableCell><TableCell>{course.department_name}</TableCell><TableCell>{course.credits || '記載なし'}</TableCell>
      </TableRow>)}</TableBody>
    </Table></div>
  );
}

function useLocalLibrary() {
  const [library, setLibrary] = useState<LocalLibrary>(emptyLibrary);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const read = () => {
      try { setLibrary(decodeLibrary(localStorage.getItem(LIBRARY_KEY))); }
      catch { setMessage('保存データを読み込めませんでした。ブラウザの保存設定をご確認ください。'); }
      setReady(true);
    };
    read();
    const sync = (event: StorageEvent) => { if (event.key === LIBRARY_KEY || event.key === null) read(); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const persist = (change: (current: LocalLibrary) => LocalLibrary, success: string) => {
    try {
      // Read before editing so another tab's favorites are retained.
      const next = change(decodeLibrary(localStorage.getItem(LIBRARY_KEY)));
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
      setLibrary(next); setMessage(success); return true;
    } catch { setMessage('保存できませんでした。ブラウザの保存容量・設定をご確認ください。'); return false; }
  };
  return { library, ready, message, persist };
}

type SaveLibrary = (change: (current: LocalLibrary) => LocalLibrary, success: string) => void;
function LibraryToolbar({ ready, picked, selectedIds, favoriteIds, save, clear }: {
  ready: boolean; picked: CourseSummary[]; selectedIds: Set<string>; favoriteIds: Set<string>; save: SaveLibrary; clear: () => void;
}) {
  if (picked.length === 0) return null;
  return <div className="library-toolbar selection-toolbar">
    <span>{picked.length}件選択中</span>
    <Button variant="outline" size="sm" disabled={!ready} onClick={() => save(current => ({ ...current, favorites: [...current.favorites.filter(item => !selectedIds.has(item.id)), ...picked] }), `${picked.length}件をお気に入りに追加しました。`)}><Star />お気に入りに追加</Button>
    {picked.some(item => favoriteIds.has(item.id)) && <Button variant="ghost" size="sm" onClick={() => save(current => ({ ...current, favorites: current.favorites.filter(item => !selectedIds.has(item.id)) }), '選択した講義をお気に入りから解除しました。')}>お気に入りから解除</Button>}
    <Button variant="ghost" size="sm" onClick={clear}>選択解除</Button>
  </div>;
}

function SavedConditionMenu({ ready, library, props, save }: { ready: boolean; library: LocalLibrary; props: SearchProps; save: SaveLibrary }) {
  const filters = props.filters;
  const selectedDepartments = new Set(filters.department);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'page') continue;
    const text = Array.isArray(value) ? value.join(',') : String(value);
    if (text) params.set(key, text);
  }
  const label = [filters.q, filters.title, filters.teacher, filters.room, ...props.availableFilters.departments.filter(d => selectedDepartments.has(d.id)).map(d => d.name),
    ...filters.term, ...filters.day.map(day => `${'月火水木金土日'[Number(day) - 1]}曜`), ...filters.period.map(period => `${period}限`),
    ...filters.intensive.map(value => value === 'yes' ? '集中' : '集中以外'), ...filters.modality.map(value => modalityLabels[value as keyof typeof modalityLabels]), `${filters.year}年度`].filter(Boolean).join('・');
  return <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm"><Bookmark />検索条件</Button></PopoverTrigger><PopoverContent align="end" className="saved-condition-menu" aria-label="検索条件の保存">
    <h3>検索条件を保存</h3><p>このブラウザで使えます。</p>
    <Button variant="outline" size="sm" disabled={!ready} onClick={() => save(current => ({ ...current, condition: { url: `/?${params}`, label, savedAt: new Date().toISOString() } }), '検索条件を保存しました。')}>{library.condition ? '現在の条件で上書き' : '現在の条件を保存'}</Button>
    {library.condition && <div className="saved-condition-item"><span>保存した条件</span><p>{library.condition.label}</p><div><Button size="sm" asChild><Link href={library.condition.url}>この条件で検索</Link></Button><Button size="sm" variant="ghost" onClick={() => save(current => ({ ...current, condition: null }), '保存した検索条件を削除しました。')}>削除</Button></div></div>}
  </PopoverContent></Popover>;
}

const viewTitles: Record<View, string> = { search: '検索結果', favorites: 'お気に入り' };
function getView(value: string | null): View { return value === 'favorites' ? 'favorites' : 'search'; }
function getItems(view: View, library: LocalLibrary, props: SearchProps) {
  return view === 'favorites' ? library.favorites : props.items;
}
function EmptyResults({ view, databaseReady }: { view: View; databaseReady: boolean }) {
  const titles = { favorites: 'お気に入りはまだありません', search: databaseReady ? '条件に合う講義が見つかりませんでした' : '検索データを準備しています' };
  return <div className="empty-state"><h3>{titles[view]}</h3><p>{view === 'search' ? 'キーワードを短くするか、検索条件を広げてもう一度お試しください。' : '講義の星を押すと、ここに追加されます。'}</p></div>;
}
