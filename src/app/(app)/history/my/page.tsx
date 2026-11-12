// 내 업무 이력: 본인이 기록한 개발현황·생산이관·보고 항목·개발과제를 한 표로 모아 본다.
import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { productLabel } from '@/lib/data';
import { SECTION_LABEL, parseIntParam } from '@/lib/constants';
import { MyHistoryTable, type HistoryRow } from '@/components/history/MyHistoryTable';

export const dynamic = 'force-dynamic';

const oneLine = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const brief = (...parts: (string | null | undefined)[]) => {
  const s = parts.map(oneLine).filter(Boolean).join(' · ');
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
};

export default async function MyHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const year = parseIntParam(sp.year, 0, 2000, 2100); // 0 = 전체

  const data = await withUser(me.id, async (tx) => {
    const yf = (col: 'd' | 't' | 'r') => (year ? (col === 'd' ? tx`and d.year = ${year}` : col === 't' ? tx`and t.year = ${year}` : tx`and r.year = ${year}`) : tx``);
    // 본인 기록만: user_id 를 명시해 걸러 낸다(관리자도 이 화면에서는 본인 것만 본다).
    const years = await tx`
      select distinct y from (
        select year as y from dev_works where user_id = ${me.id}
        union select year from transfers where user_id = ${me.id}
        union select year from monthly_reports where user_id = ${me.id}) x
      order by y desc`;
    const devWorks = await tx`
      select d.id, d.year, d.month, d.title, d.revision, d.status, d.progress, d.work_done, p.name as product_name, p.model
      from dev_works d join products p on p.id = d.product_id
      where d.user_id = ${me.id} ${yf('d')}`;
    const transfers = await tx`
      select t.id, t.year, t.month, t.content, t.plan, t.transfer_status, p.name as product_name, p.model
      from transfers t join products p on p.id = t.product_id
      where t.user_id = ${me.id} ${yf('t')}`;
    const items = await tx`
      select i.id, i.section, i.title, i.item_name, i.revision, i.change_note, i.content, i.vendor, i.status,
             r.id as report_id, r.year, r.month, r.status as report_status, p.name as product_name, p.model
      from report_items i
      join monthly_reports r on r.id = i.report_id
      left join products p on p.id = i.product_id
      where r.user_id = ${me.id} ${yf('r')}`;
    const projects = await tx`
      select m.id, m.progress, m.status, m.result, j.name, r.id as report_id, r.year, r.month, r.status as report_status,
             p.name as product_name, p.model
      from dev_project_monthly m
      join dev_projects j on j.id = m.project_id
      join monthly_reports r on r.id = m.report_id
      left join products p on p.id = j.product_id
      where j.user_id = ${me.id} and r.user_id = ${me.id} ${yf('r')}`;
    return { years: years.map((r) => r.y as number), devWorks, transfers, items, projects };
  });

  const prod = (r: { product_name?: string | null; model?: string | null }) => (r.product_name ? productLabel({ name: r.product_name, model: r.model ?? '' }) : '');
  const rows: HistoryRow[] = [
    ...data.devWorks.map((r): HistoryRow => ({
      key: `dev:${r.id}`, year: r.year, month: r.month, kind: '개발현황', product: prod(r), summary: brief(r.title, r.work_done),
      revision: r.revision, status: r.status, progress: r.progress, reportStatus: null,
      href: `/dev-status?year=${r.year}&month=${r.month}&tab=detail`,
    })),
    ...data.transfers.map((r): HistoryRow => ({
      key: `tr:${r.id}`, year: r.year, month: r.month, kind: '생산이관', product: prod(r), summary: brief(r.content, r.plan),
      revision: '', status: r.transfer_status, progress: null, reportStatus: null,
      href: `/transfers?year=${r.year}&month=${r.month}&tab=detail`,
    })),
    ...data.items.map((r): HistoryRow => ({
      key: `item:${r.id}`, year: r.year, month: r.month, kind: SECTION_LABEL[r.section] ?? '보고 항목', product: prod(r),
      summary: brief(r.title || r.item_name, r.change_note, r.content, r.vendor),
      revision: r.revision, status: r.status, progress: null, reportStatus: r.report_status,
      href: `/reports/${r.report_id}`,
    })),
    ...data.projects.map((r): HistoryRow => ({
      key: `proj:${r.id}`, year: r.year, month: r.month, kind: '개발과제', product: prod(r), summary: brief(r.name, r.result),
      revision: '', status: r.status, progress: r.progress, reportStatus: r.report_status,
      href: `/reports/${r.report_id}`,
    })),
  ];
  rows.sort((a, b) => b.year - a.year || b.month - a.month || a.kind.localeCompare(b.kind, 'ko') || a.product.localeCompare(b.product, 'ko'));

  return <MyHistoryTable rows={rows} years={data.years} year={year} />;
}
