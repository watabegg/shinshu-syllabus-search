import { describe, expect, it } from 'vitest';
import { structureSyllabus } from '../src/lib/syllabus';

describe('structured syllabus', () => {
  it('recognizes layout headings, merges page continuations, and separates lesson rows', () => {
    const sections = structureSyllabus([
      { page_number: 1, raw_text: '登録コード TEST\n(1)授業の達成目標  理解する\n(4)授業の概要  基礎を学ぶ\n(5)授業計画  第1回 序論\n          詳しい内容\n          第2回 応用\n(6)成績評価の方 レポート50%\n法          試験50%\n(9)履修上の注意  提出期限を' },
      { page_number: 2, raw_text: '(9)履修上の注意  守ること。\n(10)質問,相談へ 授業後に\nの対応     受け付ける\n【教科書】  入門書\n【参考書】  専門書' },
    ]);
    expect(sections.map((section) => section.title)).toEqual(['授業の達成目標', '授業の概要', '授業計画', '成績評価の方法', '履修上の注意', '質問・相談への対応', '教科書', '参考書']);
    expect(sections[2].lessons).toEqual([{ label: '第1回', text: '序論\n詳しい内容' }, { label: '第2回', text: '応用' }]);
    expect(sections[3].paragraphs).toEqual(['レポート50%\n試験50%']);
    expect(sections[4].pages).toEqual([1, 2]);
    expect(sections[4].paragraphs.join('')).toContain('守ること。');
    expect(sections[5].paragraphs).toEqual(['授業後に\n受け付ける']);
  });

  it('keeps unfamiliar formats and faculty-specific sections without interpreting text as markup', () => {
    expect(structureSyllabus([{ page_number: 1, raw_text: '<script>untrusted</script>\nUnusual template' }])[0].paragraphs[0]).toContain('<script>');
    const sections = structureSyllabus([{ page_number: 1, raw_text: '(1)授業の概要 内容\n             その他 これは本文内の記載\n(2)特殊実習項目 留意事項' }]);
    expect(sections).toHaveLength(2);
    expect(sections[0].paragraphs.join('')).toContain('その他');
    expect(sections[1].title).toBe('特殊実習項目');
    expect(sections[1].paragraphs).toEqual(['留意事項']);
  });

  it('handles unnumbered headings, numbered lesson lists, and empty fields', () => {
    const sections = structureSyllabus([{ page_number: 1, raw_text: '授業の概要 概要\n授業計画 1. 初回\n         2. 次回\nその他\n【参考書】 なし' }]);
    expect(sections[1].lessons).toEqual([{ label: '1.', text: '初回' }, { label: '2.', text: '次回' }]);
    expect(sections[2].paragraphs).toEqual([]);
    expect(sections[3].paragraphs).toEqual(['なし']);
  });
});
