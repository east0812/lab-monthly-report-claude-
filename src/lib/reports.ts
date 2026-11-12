// 월차보고 조회·검증 (서버). 화면과 출력(Excel/HTML)이 같은 데이터를 쓴다.
import path from 'node:path';
import { HttpError, type Tx, type Row } from './db';
import { SECTIONS, ITEM_STATUS_KEYS, type ItemStatus, type ReportStatus, type SectionKey, type WorkStatus } from './constants';
import { str, text, optUuid, optNum, oneOf } from './validate';

export type Report = {
  id: string; user_id: string; user_name: string; year: number; month: number; status: ReportStatus; summary: string;
  reject_reason: string | null; submitted_at: string | null; reviewed_at: string | null; finalized_at: string | null; rejected_at: string | null;
  version: number; created_at: string; updated_at: string;
};
export type ReportItem = {
  id: string; section: SectionKey; sort_order: number; product_id: string | null; category_id: string | null; title: string; revision: string;
  change_note: string; content: string; item_name: string; vendor: string; quantity: number | null; unit: string; schedule: string;
  status: ItemStatus; note: string; version: number; product_name: string | null; product_model: string | null; category_name: string | null;
};
export type ReportProject = {
  id: string; project_id: string; progress: number; status: ItemStatus; result: string; issue: string; next_plan: string; version: number;
  name: string; goal: string; start_date: string | null; end_date: string | null; product_id: string | null; category_id: string | null;
  project_version: number; product_name: string | null; product_model: string | null; category_name: string | null;
};
export type Attachment = { id: string; file_name: string; mime_type: string; size_bytes: number; created_at: string };
export type HistoryRow = { id: string; from_status: ReportStatus | null; to_status: ReportStatus; reason: string | null; created_at: string; actor_name: string | null };
export type DevWorkRow = {
  id: string; user_id: string; year: number; month: number; product_id: string; revision: string; category_id: string | null; title: string; status: WorkStatus; progress: number;
  work_done: string; test_result: string; issues: string; actions: string; next_plan: string; carried_from_id: string | null; version: number;
  product_name: string; product_model: string; category_name: string | null; user_name: string;
};
export type TransferRow = {
  id: string; user_id: string; year: number; month: number; product_id: string; dev_status: WorkStatus; transfer_status: WorkStatus;
  planned_date: string | null; completed_date: string | null; content: string; plan: string; version: number;
  product_name: string; product_model: string; user_name: string;
};
export type ReportFull = {
  report: Report; items: ReportItem[]; projects: ReportProject[]; attachments: Attachment[]; history: HistoryRow[];
  devWorks: DevWorkRow[]; transfers: TransferRow[];
};

/** 담당자·연월 조건으로 개발현황 조회 (userId 생략 시 RLS 범위 전체) */
export async function loadDevWorks(tx: Tx, year: number, month: number, userId?: string): Promise<DevWorkRow[]> {
  return (await tx`
    select d.id, d.user_id, d.year, d.month, d.product_id, d.revision, d.category_id, d.title, d.status, d.progress,
           d.work_done, d.test_result, d.issues, d.actions, d.next_plan, d.carried_from_id, d.version,
           p.name as product_name, p.model as product_model, c.name as category_name, user_name(d.user_id) as user_name
    from dev_works d join products p on p.id = d.product_id left join work_categories c on c.id = d.category_id
    where d.year = ${year} and d.month = ${month} ${userId ? tx`and d.user_id = ${userId}` : tx``}
    order by p.name, p.model, user_name, d.created_at`) as unknown as DevWorkRow[];
}
export async function loadTransfers(tx: Tx, year: number, month: number, userId?: string): Promise<TransferRow[]> {
  return (await tx`
    select t.id, t.user_id, t.year, t.month, t.product_id, t.dev_status, t.transfer_status, t.planned_date, t.completed_date,
           t.content, t.plan, t.version, p.name as product_name, p.model as product_model, user_name(t.user_id) as user_name
    from transfers t join products p on p.id = t.product_id
    where t.year = ${year} and t.month = ${month} ${userId ? tx`and t.user_id = ${userId}` : tx``}
    order by p.name, p.model, user_name, t.created_at`) as unknown as TransferRow[];
}

/** 보고서 한 건의 전체 내용. 볼 권한이 없으면(RLS) null. */
export async function loadReport(tx: Tx, id: string): Promise<ReportFull | null> {
  const [report] = (await tx`select r.*, user_name(r.user_id) as user_name from monthly_reports r where r.id = ${id}`) as unknown as Report[];
  if (!report) return null;
  const items = (await tx`
    select i.id, i.section, i.sort_order, i.product_id, i.category_id, i.title, i.revision, i.change_note, i.content, i.item_name, i.vendor,
           i.quantity, i.unit, i.schedule, i.status, i.note, i.version,
           p.name as product_name, p.model as product_model, c.name as category_name
    from report_items i left join products p on p.id = i.product_id left join work_categories c on c.id = i.category_id
    where i.report_id = ${id} order by i.section, i.sort_order, i.created_at`) as unknown as ReportItem[];
  const projects = (await tx`
    select m.id, m.project_id, m.progress, m.status, m.result, m.issue, m.next_plan, m.version,
           j.name, j.goal, j.start_date, j.end_date, j.product_id, j.category_id, j.version as project_version,
           p.name as product_name, p.model as product_model, c.name as category_name
    from dev_project_monthly m join dev_projects j on j.id = m.project_id
      left join products p on p.id = j.product_id left join work_categories c on c.id = j.category_id
    where m.report_id = ${id} order by j.created_at`) as unknown as ReportProject[];
  const attachments = (await tx`select id, file_name, mime_type, size_bytes, created_at from report_attachments where report_id = ${id} order by created_at`) as unknown as Attachment[];
  const history = (await tx`
    select h.id, h.from_status, h.to_status, h.reason, h.created_at, user_name(h.actor_id) as actor_name
    from report_status_history h where h.report_id = ${id} order by h.created_at`) as unknown as HistoryRow[];
  const devWorks = await loadDevWorks(tx, report.year, report.month, report.user_id);
  const transfers = await loadTransfers(tx, report.year, report.month, report.user_id);
  return { report, items, projects, attachments, history, devWorks, transfers };
}

/** 섹션에 허용된 입력란만 받아 정리한다. */
export function sanitizeItem(section: SectionKey, b: Record<string, unknown>): Row {
  const def = SECTIONS.find((s) => s.key === section);
  if (!def) throw new HttpError(400, '보고 항목 구분이 올바르지 않습니다.');
  const out: Row = {
    product_id: null, category_id: null, title: '', revision: '', change_note: '', content: '', item_name: '', vendor: '',
    quantity: null, unit: '', schedule: '', status: 'in_progress', note: '',
  };
  for (const f of def.fields) {
    const v = b[f.key];
    switch (f.key) {
      case 'product_id': out.product_id = optUuid(v, '제품'); break;
      case 'category_id': out.category_id = optUuid(v, '업무 분류'); break;
      case 'quantity': out.quantity = optNum(v, '수량'); break;
      case 'status': out.status = oneOf<ItemStatus>(v ?? 'in_progress', ITEM_STATUS_KEYS, '상태'); break;
      case 'change_note': case 'content': out[f.key] = text(v, 3000, f.label); break;
      default: out[f.key] = str(v, f.key === 'note' ? 1000 : 200, f.label);
    }
    if (f.required && !out[f.key]) throw new HttpError(400, `${f.label}: 값을 입력해 주세요.`);
  }
  return out;
}

// ── 첨부파일 저장 위치 ──
export function attachmentBaseDir(): string {
  return path.resolve(process.env.ATTACHMENT_DIR || './data/attachments');
}
/** 보고서별 폴더 안의 저장 경로. 경로 조작을 막기 위해 base 밖이면 거부한다. */
export function attachmentPath(reportId: string, storedName: string): string {
  const base = attachmentBaseDir();
  const p = path.resolve(base, reportId, storedName);
  if (!p.startsWith(base + path.sep)) throw new HttpError(400, '잘못된 파일 경로입니다.');
  return p;
}
const MIME: Record<string, string> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel', '.csv': 'text/csv',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.ppt': 'application/vnd.ms-powerpoint', '.pdf': 'application/pdf',
};
/** 확장자와 파일 앞부분(시그니처)이 맞는지 확인. 맞으면 MIME, 아니면 null. */
export function sniffAttachment(ext: string, head: Buffer): string | null {
  const zip = head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b;
  const ole = head.length >= 8 && head.readUInt32BE(0) === 0xd0cf11e0;
  const pdf = head.subarray(0, 5).toString('latin1') === '%PDF-';
  const ok = { '.xlsx': zip, '.pptx': zip, '.xls': ole, '.ppt': ole, '.pdf': pdf, '.csv': !zip && !ole && !pdf && !head.subarray(0, 512).includes(0) }[ext];
  return ok ? MIME[ext] : null;
}
