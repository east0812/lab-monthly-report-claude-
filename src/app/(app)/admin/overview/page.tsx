// 관리자 연구소 현황: 선택 월의 제출 현황, 업무 상태별 건수, 최근 추이, 매출·판매수량
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { kstNow, parseIntParam, fmtNum, fmtWon, REPORT_STATUS, WORK_STATUS, WORK_STATUS_KEYS, type ReportStatus, type WorkStatus } from '@/lib/constants';
import { salesYearSummary } from '@/lib/sales-data';
import { barChart } from '@/lib/charts';
import { Badge, Card, PageHeader, YearMonthNav, Button } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const now = kstNow();
  const year = parseIntParam(sp.year, now.year, 2000, 2100);
  const month = parseIntParam(sp.month, now.month, 1, 12);
  const idx = year * 12 + (month - 1);
  const d = await withUser(me.id, async (tx) => {
    const staff = await tx`
      select p.id, p.name, r.id as report_id, r.status
      from profiles p left join monthly_reports r on r.user_id = p.id and r.year = ${year} and r.month = ${month}
      where p.is_active order by p.name`;
    const dev = await tx`select status, count(*) as n from dev_works where year = ${year} and month = ${month} group by status`;
    const tr = await tx`select transfer_status as status, count(*) as n from transfers where year = ${year} and month = ${month} group by transfer_status`;
    const items = await tx`
      select s as status, count(*) as n from (
        select i.status::text as s from report_items i join monthly_reports r on r.id = i.report_id where r.year = ${year} and r.month = ${month}
        union all select m.status::text from dev_project_monthly m join monthly_reports r on r.id = m.report_id where r.year = ${year} and r.month = ${month}) x group by s`;
    // 최근 6개월 추이
    const trendDev = await tx`
      select year, month, count(*) filter (where status = 'done') as done, count(*) filter (where status = 'in_progress') as in_progress,
             count(*) filter (where status = 'on_hold') as on_hold, count(*) filter (where status in ('planned','stopped')) as etc
      from dev_works where year * 12 + month - 1 between ${idx - 5} and ${idx} group by year, month`;
    const trendRep = await tx`
      select year, month, count(*) filter (where status in ('submitted','reviewed','finalized')) as submitted
      from monthly_reports where year * 12 + month - 1 between ${idx - 5} and ${idx} group by year, month`;
    const sales = await salesYearSummary(tx, year);
    const salesPrev = await salesYearSummary(tx, year - 1);
    return { staff, dev, tr, items, trendDev, trendRep, sales, salesPrev };
  });

  const by = (st: ReportStatus | null) => d.staff.filter((s) => (s.status ?? null) === st);
  const submitted = d.staff.filter((s) => s.status && ['submitted', 'reviewed', 'finalized'].includes(s.status)).length;
  const cnt = (rows: { status: string; n: number }[], s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
  const months = Array.from({ length: 6 }, (_, i) => { const t = idx - 5 + i; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; });
  const tv = (rows: Record<string, number>[], y: number, m: number, k: string) => Number(rows.find((r) => r.year === y && r.month === m)?.[k] ?? 0);
  const labels = months.map((x) => `${String(x.y).slice(2)}.${x.m}월`);
  const devChart = barChart({
    labels, stacked: true, unit: '건', width: 560, height: 260, title: '최근 6개월 개발 업무 상태',
    series: [
      { name: '완료', color: WORK_STATUS.done.color, values: months.map((x) => tv(d.trendDev as never, x.y, x.m, 'done')) },
      { name: '진행중', color: WORK_STATUS.in_progress.color, values: months.map((x) => tv(d.trendDev as never, x.y, x.m, 'in_progress')) },
      { name: '보류', color: WORK_STATUS.on_hold.color, values: months.map((x) => tv(d.trendDev as never, x.y, x.m, 'on_hold')) },
      { name: '예정·중단', color: WORK_STATUS.planned.color, values: months.map((x) => tv(d.trendDev as never, x.y, x.m, 'etc')) },
    ],
  });
  const repChart = barChart({
    labels, unit: '건', width: 560, height: 260, title: '최근 6개월 보고서 제출 건수',
    series: [{ name: '제출(제출완료·확인·확정)', color: '#2563eb', values: months.map((x) => tv(d.trendRep as never, x.y, x.m, 'submitted')) }],
  });
  const cur = d.sales[month - 1];
  const prevM = month === 1 ? d.salesPrev[11] : d.sales[month - 2];
  const lastY = d.salesPrev[month - 1];
  const rate = (a: number | null, b: number | null) => (a === null || b === null || b <= 0 ? null : ((a - b) / b) * 100);
  const rateText = (r: number | null) => (r === null ? '-' : `${r >= 0 ? '▲' : '▼'} ${Math.abs(r).toFixed(1)}%`);
  const q = `year=${year}&month=${month}`;

  return (
    <div className="space-y-4">
      <PageHeader title="연구소 현황" desc={`${year}년 ${month}월 기준`} actions={<YearMonthNav year={year} month={month} />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="제출 현황" actions={<Link href={`/admin/reports?${q}`} className="text-xs text-blue-700 hover:underline">월차보고 관리 →</Link>}>
          <div className="flex items-end gap-3">
            <div className="text-4xl font-bold tabular-nums text-blue-700">{submitted}<span className="text-lg font-medium text-slate-500"> / {d.staff.length}명</span></div>
            <div className="pb-1 text-sm text-slate-600">제출 (제출완료·관리자 확인·최종확정)</div>
          </div>
          <div className="mt-3 h-2.5 rounded-full bg-slate-200" role="progressbar" aria-valuenow={submitted} aria-valuemin={0} aria-valuemax={d.staff.length} aria-label="제출 비율">
            <div className="h-2.5 rounded-full bg-blue-600" style={{ width: `${d.staff.length ? (submitted / d.staff.length) * 100 : 0}%` }} />
          </div>
          <dl className="mt-4 space-y-1.5 text-sm">
            {([...(['submitted', 'reviewed', 'finalized', 'rejected', 'draft'] as ReportStatus[]), null] as (ReportStatus | null)[]).map((st) => (
              <div key={st ?? 'none'} className="flex items-start gap-2">
                <dt className="w-28 shrink-0">{st ? <Badge cls={REPORT_STATUS[st].cls}>{REPORT_STATUS[st].label} {by(st).length}</Badge> : <Badge cls="bg-white text-slate-500 ring-slate-300">미작성 {by(null).length}</Badge>}</dt>
                <dd className="text-slate-700">{by(st).map((s) => s.report_id ? <Link key={s.id} href={`/reports/${s.report_id}`} className="mr-2 hover:underline">{s.name}</Link> : <span key={s.id} className="mr-2">{s.name}</span>)}{by(st).length === 0 && <span className="text-slate-400">-</span>}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="업무 상태별 건수">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-slate-500"><th className="py-1 text-left font-medium">구분</th>{WORK_STATUS_KEYS.map((s) => <th key={s} className="py-1 text-right font-medium">{WORK_STATUS[s].mark} {WORK_STATUS[s].label}</th>)}<th className="py-1 text-right font-medium">합계</th></tr></thead>
            <tbody className="tabular-nums">
              {([['개발현황', d.dev], ['생산이관', d.tr], ['보고 항목·개발과제', d.items]] as unknown as [string, { status: string; n: number }[]][]).map(([label, rows]) => (
                <tr key={label} className="border-t border-slate-100">
                  <th className="py-2 text-left font-medium text-slate-800">{label}</th>
                  {WORK_STATUS_KEYS.map((s: WorkStatus) => <td key={s} className="py-2 text-right">{cnt(rows, s) || <span className="text-slate-300">0</span>}</td>)}
                  <td className="py-2 text-right font-semibold">{rows.reduce((a, r) => a + Number(r.n), 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">선택한 달에 기록된 전체 직원의 업무입니다. 보고 항목·개발과제는 완료·진행중·보류만 사용합니다.</p>
        </Card>
      </div>
      <Card title="최근 추이 (6개월)">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: repChart }} />
          <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: devChart }} />
        </div>
      </Card>
      <Card title={`${month}월 매출 · 판매수량`} actions={<Link href={`/admin/sales?${q}`}><Button size="sm">연구소 매출현황 →</Button></Link>}>
        {!cur.registered ? (
          <p className="text-sm text-slate-600"><Badge cls="bg-amber-50 text-amber-800 ring-amber-300">미등록</Badge> <span className="ml-2">이 달의 매출 자료가 아직 등록되지 않았습니다. (실제 0원과 구분됩니다)</span></p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><div className="text-xs font-medium text-slate-500">총금액 (부가세 포함)</div><div className="mt-1 whitespace-nowrap text-2xl font-bold tabular-nums text-slate-900">{fmtWon(cur.total)}</div>{cur.zeroConfirmed && <div className="text-xs text-slate-500">매출 없음(0원) 확정</div>}<div className="text-xs text-slate-500">공급가액 {fmtWon(cur.supply)} · 부가세 {fmtWon(cur.vat)}</div></div>
            <div><div className="text-xs font-medium text-slate-500">판매수량 (단위별)</div><div className="mt-1 text-lg font-semibold tabular-nums">{cur.qty.length ? cur.qty.map((x) => <span key={x.unit} className="mr-3 whitespace-nowrap">{fmtNum(x.qty, 2)} {x.unit}</span>) : '-'}</div><div className="text-xs text-slate-500">거래 {fmtNum(cur.count)}건</div></div>
            <div><div className="text-xs font-medium text-slate-500">전월 대비</div><div className="mt-1 text-lg font-semibold tabular-nums">{rateText(rate(cur.total, prevM?.total ?? null))}</div><div className="whitespace-nowrap text-xs text-slate-500">전월 {prevM?.registered ? fmtWon(prevM.total) : '미등록'}</div></div>
            <div><div className="text-xs font-medium text-slate-500">전년 동월 대비</div><div className="mt-1 text-lg font-semibold tabular-nums">{rateText(rate(cur.total, lastY?.total ?? null))}</div><div className="whitespace-nowrap text-xs text-slate-500">전년 동월 {lastY?.registered ? fmtWon(lastY.total) : '미등록'}</div></div>
          </div>
        )}
      </Card>
    </div>
  );
}
