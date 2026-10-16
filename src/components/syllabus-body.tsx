import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { DetailProps } from '@/lib/contracts';

export function SyllabusBody(props: Pick<DetailProps, 'sections' | 'pages'>) {
  return (
    <>
              {props.sections.length > 0 ? (
                <>
                  <nav className="syllabus-nav" aria-label="シラバスの目次">
                    <ol>{props.sections.map((section, index) => <li key={section.id}><a href={`#${section.id}`}><span className="toc-number" aria-hidden="true">{index + 1}</span><span>{section.title}</span></a></li>)}</ol>
                  </nav>
                  {props.sections.map((section) => (
                    <section id={section.id} key={section.id} className="syllabus-section" aria-labelledby={`${section.id}-title`}>
                      <h3 id={`${section.id}-title`}>{section.title}</h3>
                      {section.paragraphs.map((paragraph, index) => <p className="syllabus-text" key={`${section.id}-${index}`}>{paragraph}</p>)}
                      {section.lessons.length > 0 && (
                        <Table>
                          <TableHeader><TableRow><TableHead className="w-24">回</TableHead><TableHead>授業内容</TableHead></TableRow></TableHeader>
                          <TableBody>{section.lessons.map((lesson, index) => (
                            <TableRow key={`${section.id}-${index}`}><TableCell className="align-top font-medium">{lesson.label}</TableCell><TableCell className="syllabus-text min-w-0 whitespace-pre-line">{lesson.text}</TableCell></TableRow>
                          ))}</TableBody>
                        </Table>
                      )}
                      {section.paragraphs.length === 0 && section.lessons.length === 0 && <p className="muted">記載なし</p>}
                    </section>
                  ))}
                </>
              ) : <p className="muted">本文テキストはありません。原本PDFをご確認ください。</p>}
              {props.pages.length > 0 && (
                <Collapsible className="mt-4">
                  <CollapsibleTrigger asChild><Button variant="ghost" size="sm">抽出原文を確認<ChevronDown aria-hidden="true" /></Button></CollapsibleTrigger>
                  <CollapsibleContent className="raw-pages mt-3">
                    {props.pages.map((page) => <section className="raw-page" key={page.page_number} aria-label={`${page.page_number}ページ目の原文`}><h3>原文 · {page.page_number}ページ</h3><pre>{page.raw_text}</pre></section>)}
                  </CollapsibleContent>
                </Collapsible>
              )}
    </>
  );
}
