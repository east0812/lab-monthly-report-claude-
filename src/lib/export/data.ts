// 출력(Excel / HTML / 인쇄)용 데이터 수집. 모두 요청자 권한의 RLS 트랜잭션에서 읽은 "저장된 데이터"만 담는다.
// 계정 식별자·이메일·인증 정보·첨부 저장 경로는 담지 않는다.
import type { Tx } from '../db';
import { loadTimeline, type TimelineRow } from '../data';
import { loadReport, loadDevWorks, loadTransfers, type DevWorkRow, type ReportItem, type ReportProject, type TransferRow } from '../reports';
import { REPORT_STATUS, SHARED_STATUSES, fmtDateTime, type ReportStatus } from '../constants';
import { salesYearSummary, salesFiveYears, type SalesMonth, type SalesYear } from '../sales-data';

export type ExportData = {
  kind: 'personal' | 'compile';
  labName: string;
  title: string;          // 예: 2026년 11월 월차보고
  subtitle: string;       // 작성자 또는 "연구소 전체 취합"
  year: number; month: number;
  generatedAt: string;    // 한국시간 문자열
  summaries: { name: string; status: string; submittedAt: string; summary: string }[];
  submission: { name: string; status: string; submittedAt: string }[] | null; // 취합만
  items: (ReportItem & { user_name: string })[];
  projects: (ReportProject & { user_name: string })[];
  devWorks: (DevWorkRow & { submitted: boolean })[];
  transfers: (TransferRow & { submitted: boolean })[];
  devTimeline: TimelineRow[];
  transferTimeline: TimelineRow[];
  attachments: string[];  // 파일명만
  sales: { months: SalesMonth[]; prevMonths: SalesMonth[]; years: SalesYear[] } | null; // 관리자 취합만
};

async function labNameOf(tx: Tx): Promise<string> {
  const [s] = await tx`select coalesce((select value from app_settings where key = 'lab_name'), '') as v`;
  return s.v || '연구소';
}
const stamp = () => `${fmtDateTime(new Date().toISOString())} (KST)`;

/** 직원 개인 보고서. 볼 권한이 없으면 null. */
export async function personalExport(tx: Tx, reportId: string): Promise<ExportData | null> {
  const full = await loadReport(tx, reportId);
  if (!full) return null;
  const { report } = full;
  const submitted = (SHARED_STATUSES as string[]).includes(report.status);
  return {
    kind: 'personal', labName: await labNameOf(tx),
    title: `${report.year}년 ${report.month}월 월차보고`, subtitle: `작성자 ${report.user_name}`,
    year: report.year, month: report.month, generatedAt: stamp(),
    summaries: [{ name: report.user_name, status: REPORT_STATUS[report.status].label, submittedAt: fmtDateTime(report.submitted_at), summary: report.summary }],
    submission: null,
    items: full.items.map((i) => ({ ...i, user_name: report.user_name })),
    projects: full.projects.map((p) => ({ ...p, user_name: report.user_name })),
    devWorks: full.devWorks.map((d) => ({ ...d, submitted })),
    transfers: full.transfers.map((t) => ({ ...t, submitted })),
    devTimeline: await loadTimeline(tx, 'dev', report.year, { userId: report.user_id }),
    transferTimeline: await loadTimeline(tx, 'transfer', report.year, { userId: report.user_id }),
    attachments: full.attachments.map((a) => a.file_name),
    sales: null,
  };
}

/** 관리자 월별 전체 취합. 보고서 본문은 제출 이후 상태만 포함한다. */
export async function compileExport(tx: Tx, year: number, month: number): Promise<ExportData> {
  const staff = await tx`
    select p.id, p.name, r.id as report_id, r.status, r.submitted_at, r.summary
    from profiles p left join monthly_reports r on r.user_id = p.id and r.year = ${year} and r.month = ${month}
    where p.is_active or r.id is not null order by p.name`;
  const sharedIds = staff.filter((s) => s.status && (SHARED_STATUSES as string[]).includes(s.status)).map((s) => s.report_id as string);
  const submittedUsers = new Set(staff.filter((s) => s.status && (SHARED_STATUSES as string[]).includes(s.status)).map((s) => s.id as string));
  const items = sharedIds.length ? await tx`
    select i.id, i.section, i.sort_order, i.product_id, i.category_id, i.title, i.revision, i.change_note, i.content, i.item_name, i.vendor,
           i.quantity, i.unit, i.schedule, i.status, i.note, i.version,
           p.name as product_name, p.model as product_model, c.name as category_name, user_name(r.user_id) as user_name
    from report_items i join monthly_reports r on r.id = i.report_id
      left join products p on p.id = i.product_id left join work_categories c on c.id = i.category_id
    where i.report_id in ${tx(sharedIds)} order by i.section, user_name, i.sort_order, i.created_at` : [];
  const projects = sharedIds.length ? await tx`
    select m.id, m.project_id, m.progress, m.status, m.result, m.issue, m.next_plan, m.version,
           j.name, j.goal, j.start_date, j.end_date, j.product_id, j.category_id, j.version as project_version,
           p.name as product_name, p.model as product_model, c.name as category_name, user_name(j.user_id) as user_name
    from dev_project_monthly m join dev_projects j on j.id = m.project_id
      left join products p on p.id = j.product_id left join work_categories c on c.id = j.category_id
    where m.report_id in ${tx(sharedIds)} order by user_name, j.created_at` : [];
  const devWorks = await loadDevWorks(tx, year, month);
  const transfers = await loadTransfers(tx, year, month);
  return {
    kind: 'compile', labName: await labNameOf(tx),
    title: `${year}년 ${month}월 월차보고`, subtitle: '연구소 전체 취합',
    year, month, generatedAt: stamp(),
    summaries: staff.filter((s) => sharedIds.includes(s.report_id)).map((s) => ({
      name: s.name, status: REPORT_STATUS[s.status as ReportStatus].label, submittedAt: fmtDateTime(s.submitted_at), summary: s.summary ?? '' })),
    submission: staff.map((s) => ({ name: s.name, status: s.status ? REPORT_STATUS[s.status as ReportStatus].label : '미작성', submittedAt: fmtDateTime(s.submitted_at) })),
    items: items as unknown as ExportData['items'],
    projects: projects as unknown as ExportData['projects'],
    devWorks: devWorks.map((d) => ({ ...d, submitted: submittedUsers.has(d.user_id) })),
    transfers: transfers.map((t) => ({ ...t, submitted: submittedUsers.has(t.user_id) })),
    devTimeline: await loadTimeline(tx, 'dev', year),
    transferTimeline: await loadTimeline(tx, 'transfer', year),
    attachments: [],
    sales: { months: await salesYearSummary(tx, year), prevMonths: await salesYearSummary(tx, year - 1), years: await salesFiveYears(tx, year) },
  };
}

/** 업무 상태별 건수 (개발현황 + 생산이관 + 보고 항목 + 개발과제) */
export function statusCounts(d: ExportData) {
  const c = { total: 0, done: 0, in_progress: 0, on_hold: 0, planned: 0, stopped: 0 } as Record<string, number>;
  const add = (s: string) => { c.total++; c[s] = (c[s] ?? 0) + 1; };
  d.devWorks.forEach((w) => add(w.status));
  d.transfers.forEach((t) => add(t.transfer_status));
  d.items.forEach((i) => add(i.status));
  d.projects.forEach((p) => add(p.status));
  return c;
}
