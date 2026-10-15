import type { Modality } from './contracts';

// Product default: unspecified delivery is treated as in-person. Raw PDF evidence stays unchanged.
export function effectiveModalities(values: Modality[]): Modality[] {
  return [...new Set((values.length ? values : ['unknown'] as Modality[])
    .map((value): Modality => value === 'unknown' ? 'in_person' : value))];
}

export interface SyllabusSection {
  id: string;
  title: string;
  pages: number[];
  paragraphs: string[];
  lessons: { label: string; text: string }[];
}

type Heading = { title: string; labels: string[]; continuations?: string[] };
const headings: Heading[] = [
  { title: '授業の達成目標', labels: ['授業の達成目標', '到達目標', '学習目標'] },
  { title: '授業で学べるテーマ', labels: ['授業で学べる「テーマ」', '授業で学べる'], continuations: ['「テーマ」'] },
  { title: '全学横断特別教育プログラム', labels: ['全学横断特別教育プログラム', '全学横断特別'], continuations: ['教育プログラム'] },
  { title: '授業の概要', labels: ['授業の概要', '授業概要'] },
  { title: '授業計画', labels: ['授業計画', '授業の計画'] },
  { title: '成績評価の方法', labels: ['成績評価の方法', '成績評価の方'], continuations: ['法'] },
  { title: '成績評価の基準', labels: ['成績評価の基準', '成績評価の基'], continuations: ['準'] },
  { title: '事前事後学習の内容', labels: ['事前事後学習の内容', '事前事後学習'], continuations: ['の内容'] },
  { title: '履修上の注意', labels: ['履修上の注意', '履修上の留意点'] },
  { title: '質問・相談への対応', labels: ['質問,相談への対応', '質問、相談への対応', '質問,相談への', '質問,相談へ', '質問、相談へ'], continuations: ['の対応', '対応'] },
  { title: '授業の形式', labels: ['授業の形式', '授業方法'] },
  { title: '教科書', labels: ['【教科書】', '【教科書', '教科書'], continuations: ['】'] },
  { title: '参考書', labels: ['【参考書】', '【参考書', '参考書'], continuations: ['】'] },
  { title: 'その他', labels: ['その他'] },
];

function headingOf(line: string): { heading: Heading; body: string } | null {
  // PDF section labels live at the left edge; indented body subheadings are not section boundaries.
  if (/^\s{5}/u.test(line)) return null;
  const numbered = /^\s*[（(][０-９\d]+[）)]\s*/u;
  const text = line.replace(numbered, '').trimStart();
  for (const heading of headings) {
    for (const label of heading.labels) {
      if (!text.startsWith(label)) continue;
      const rest = text.slice(label.length);
      if (rest && !/^[\s/／:：]/u.test(rest)) continue;
      return { heading, body: rest.trim() };
    }
  }
  // Preserve unfamiliar faculty-specific numbered sections instead of dropping them.
  if (numbered.test(line)) {
    const match = text.match(/^(\S+)(?:\s+(.*))?$/u);
    if (match) return { heading: { title: match[1], labels: [match[1]] }, body: match[2] ?? '' };
  }
  return null;
}

function paragraphsOf(lines: string[]): string[] {
  return lines.join('\n').trim().split(/\n\s*\n/u).map((text) => text.trim()).filter(Boolean);
}

export function structureSyllabus(pages: { page_number: number; raw_text: string }[]): SyllabusSection[] {
  const sections: (SyllabusSection & { lines: string[] })[] = [];
  let current: (typeof sections)[number] | undefined;
  let continuation: string[] = [];
  for (const page of pages) {
    for (const original of page.raw_text.split(/\r?\n/u)) {
      const found = headingOf(original);
      if (found) {
        if (current?.title !== found.heading.title) {
          current = { id: `syllabus-${sections.length + 1}`, title: found.heading.title, pages: [], lines: [], paragraphs: [], lessons: [] };
          sections.push(current);
        }
        if (!current.pages.includes(page.page_number)) current.pages.push(page.page_number);
        if (found.body) current.lines.push(found.body);
        continuation = found.heading.continuations ?? [];
      } else if (current) {
        let text = original.trim();
        for (const suffix of continuation) {
          if (text === suffix || text.startsWith(`${suffix} `) || text.startsWith(`${suffix}\t`)) {
            text = text.slice(suffix.length).trimStart();
            continuation = [];
            break;
          }
        }
        if (text && !current.pages.includes(page.page_number)) current.pages.push(page.page_number);
        current.lines.push(text);
      }
    }
  }
  if (!sections.length) {
    return pages.some((page) => page.raw_text.trim()) ? [{
      id: 'syllabus-body', title: '授業内容', pages: pages.map((page) => page.page_number),
      paragraphs: paragraphsOf(pages.map((page) => page.raw_text)), lessons: [],
    }] : [];
  }
  return sections.map(({ lines, ...section }) => {
    if (section.title !== '授業計画') return { ...section, paragraphs: paragraphsOf(lines) };
    const introduction: string[] = [];
    for (const line of lines) {
      const match = line.match(/^(第\s*[０-９\d]+(?:\s*[〜～~－−–—-]\s*[０-９\d]+)?\s*回|[０-９\d]+[.．、])\s*(.*)$/u);
      if (match) section.lessons.push({ label: match[1], text: match[2] });
      else if (section.lessons.length) {
        const lesson = section.lessons[section.lessons.length - 1];
        lesson.text += `\n${line}`;
      } else introduction.push(line);
    }
    return { ...section, paragraphs: paragraphsOf(introduction), lessons: section.lessons.map((lesson) => ({ ...lesson, text: lesson.text.trim() })) };
  });
}
