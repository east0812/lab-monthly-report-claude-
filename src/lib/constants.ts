// 서버·클라이언트 공용 상수와 표시 유틸

export type Role = 'employee' | 'admin';
export type ReportStatus = 'draft' | 'submitted' | 'reviewed' | 'finalized' | 'rejected';
export type WorkStatus = 'planned' | 'in_progress' | 'done' | 'on_hold' | 'stopped';
export type ItemStatus = 'done' | 'in_progress' | 'on_hold';
export type SectionKey = 'sm_drawing' | 'spec' | 'education' | 'purchase' | 'machining';

export const REPORT_STATUS: Record<ReportStatus, { label: string; cls: string }> = {
  draft: { label: '작성중', cls: 'bg-slate-100 text-slate-700 ring-slate-300' },
  submitted: { label: '제출완료', cls: 'bg-blue-100 text-blue-800 ring-blue-300' },
  reviewed: { label: '관리자 확인', cls: 'bg-indigo-100 text-indigo-800 ring-indigo-300' },
  finalized: { label: '최종확정', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-300' },
  rejected: { label: '반려', cls: 'bg-rose-100 text-rose-800 ring-rose-300' },
};
export const REPORT_FLOW: ReportStatus[] = ['draft', 'submitted', 'reviewed', 'finalized'];
export const SHARED_STATUSES: ReportStatus[] = ['submitted', 'reviewed', 'finalized'];

// 색만으로 구분하지 않도록 기호를 함께 쓴다.
export const WORK_STATUS: Record<WorkStatus, { label: string; short: string; cls: string; color: string; mark: string }> = {
  planned: { label: '예정', short: '예정', cls: 'bg-slate-100 text-slate-700 ring-slate-300', color: '#64748b', mark: '○' },
  in_progress: { label: '진행중', short: '진행', cls: 'bg-blue-100 text-blue-800 ring-blue-300', color: '#2563eb', mark: '▶' },
  done: { label: '완료', short: '완료', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-300', color: '#059669', mark: '✔' },
  on_hold: { label: '보류', short: '보류', cls: 'bg-amber-100 text-amber-800 ring-amber-300', color: '#b45309', mark: '‖' },
  stopped: { label: '중단', short: '중단', cls: 'bg-rose-100 text-rose-800 ring-rose-300', color: '#be123c', mark: '✕' },
};
export const WORK_STATUS_KEYS = Object.keys(WORK_STATUS) as WorkStatus[];
export const CARRY_STATUSES: WorkStatus[] = ['planned', 'in_progress', 'on_hold'];

export const ITEM_STATUS: Record<ItemStatus, { label: string; cls: string }> = {
  in_progress: { label: '진행중', cls: WORK_STATUS.in_progress.cls },
  done: { label: '완료', cls: WORK_STATUS.done.cls },
  on_hold: { label: '보류', cls: WORK_STATUS.on_hold.cls },
};
export const ITEM_STATUS_KEYS = Object.keys(ITEM_STATUS) as ItemStatus[];

export type ItemField =
  | 'product_id' | 'category_id' | 'title' | 'revision' | 'change_note' | 'content'
  | 'item_name' | 'vendor' | 'quantity' | 'unit' | 'schedule' | 'status' | 'note';

export const SECTIONS: { key: SectionKey; label: string; fields: { key: ItemField; label: string; required?: boolean; long?: boolean }[] }[] = [
  { key: 'sm_drawing', label: 'SM 도면', fields: [
    { key: 'product_id', label: '제품' }, { key: 'title', label: '도면명', required: true }, { key: 'revision', label: 'Revision' },
    { key: 'change_note', label: '변경 내용', long: true }, { key: 'status', label: '상태' }, { key: 'note', label: '비고' } ] },
  { key: 'spec', label: '제작사양서', fields: [
    { key: 'product_id', label: '제품' }, { key: 'title', label: '사양서명', required: true }, { key: 'revision', label: 'Revision' },
    { key: 'change_note', label: '변경 내용', long: true }, { key: 'status', label: '상태' }, { key: 'note', label: '비고' } ] },
  { key: 'education', label: '교육/학습', fields: [
    { key: 'category_id', label: '업무 분류' }, { key: 'title', label: '교육/학습명', required: true }, { key: 'content', label: '내용', long: true },
    { key: 'schedule', label: '일정' }, { key: 'status', label: '상태' }, { key: 'note', label: '비고' } ] },
  { key: 'purchase', label: '타사제품 구매', fields: [
    { key: 'item_name', label: '품목', required: true }, { key: 'vendor', label: '업체' }, { key: 'quantity', label: '수량' }, { key: 'unit', label: '단위' },
    { key: 'schedule', label: '일정' }, { key: 'product_id', label: '관련 제품' }, { key: 'status', label: '상태' }, { key: 'note', label: '비고' } ] },
  { key: 'machining', label: '기구가공/기타', fields: [
    { key: 'item_name', label: '품목', required: true }, { key: 'vendor', label: '업체' }, { key: 'quantity', label: '수량' }, { key: 'unit', label: '단위' },
    { key: 'schedule', label: '일정' }, { key: 'product_id', label: '관련 제품' }, { key: 'status', label: '상태' }, { key: 'note', label: '비고' } ] },
];
export const SECTION_LABEL: Record<string, string> = Object.fromEntries(SECTIONS.map((s) => [s.key, s.label]));

export const SALE_KIND: Record<string, string> = { sale: '판매', return: '반품', freight: '운임', misc: '기타자재' };

export const ATTACH_EXT = ['.xlsx', '.xls', '.csv', '.pptx', '.ppt', '.pdf'];

// ── 한국시간(Asia/Seoul) 기준 날짜 유틸 ───────────────────────
export function kstNow(d: Date = new Date()): { year: number; month: number; day: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const [y, m, dd] = parts.split('-').map(Number);
  return { year: y, month: m, day: dd, date: parts };
}
export function prevYm(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}
export function ym(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const s = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return s; // 2026-11-11 14:05
}
export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || isNaN(Number(n))) return '';
  return Number(n).toLocaleString('ko-KR', { maximumFractionDigits: digits });
}
export function fmtWon(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return `${fmtNum(Math.round(Number(n)))}원`;
}
/** 큰 금액을 억/만 단위로 줄여 표시 (그래프 축·요약용) */
export function fmtWonShort(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e8) return `${(n / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억`;
  if (a >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`;
  return fmtNum(n);
}
export function parseIntParam(v: string | string[] | undefined | null, def: number, min: number, max: number): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
}
