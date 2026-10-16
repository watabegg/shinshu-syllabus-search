import type { SyllabusSection } from './syllabus';
export const MODALITIES = ['in_person', 'on_demand', 'live_online', 'remote_unspecified', 'unknown'] as const;
export type Modality = (typeof MODALITIES)[number];
export interface Slot { term_label: string; day_label: string; period_label: string; day: number | null; period: number | null; source_kind: 'html' | 'pdf' }
export interface IngestCourse {
 schema_version: 1; id: string; source_id: string; source_url: string; source_sha256: string; fetched_at: string;
 year: number; department: string; department_name: string; registration_code: string; variant_key: string;
 title: string; teacher_text: string; room_text: string; credits: string; term_text: string;
 title_search: string; teacher_search: string; room_search: string; code_search: string; body_search: string;
 raw_metadata: Record<string, string>; parse_warnings: string[];
 modalities: Modality[]; modality_evidence: { modality: Modality; text: string; source: string }[];
 slots: Slot[]; pages: { page_number: number; raw_text: string }[]; content_revision: string;
}
export interface SearchFilters { q: string; title: string; teacher: string; room: string; year: string; department: string; term: string[]; intensive: string[]; day: string[]; period: string[]; modality: string[]; page: number }
export interface CourseSummary { id: string; title: string; registration_code: string; year: number; department: string; department_name: string; teacher_text: string; room_text: string; credits: string; slots: Slot[]; modalities: Modality[] }
export interface Coverage { discovered: number; ready: number; failed: number; conflict: number }
export interface SearchProps { items: CourseSummary[]; filters: SearchFilters; hasNext: boolean; total: number; totalPages: number; availableFilters: { years: number[]; departments: {id:string; name:string}[]; terms: string[] }; importedAt: string | null; coverage: Coverage }
export interface DetailProps { sections: SyllabusSection[]; course: CourseSummary; pages: {page_number:number;raw_text:string}[]; sourceUrl: string; sourceSha256: string; fetchedAt: string; parseWarnings: string[]; modalityEvidence: {modality:Modality;text:string;source:string}[] }
export const modalityLabels: Record<Modality,string> = {in_person:'対面',on_demand:'オンデマンド',live_online:'オンライン（同時配信）',remote_unspecified:'遠隔（方式不明）',unknown:'記載から判定できず'};
