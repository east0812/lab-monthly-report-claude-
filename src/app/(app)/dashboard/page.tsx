// 개인 대시보드: 금월 보고서 상태, 업무 건수(전체·완료·진행중·보류), 작성 바로가기
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { kstNow, prevYm, fmtDateTime, REPORT_STATUS, type ReportStatus } from '@/lib/constants';
import { Card, PageHeader, ReportBadge, Button } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const { year, month } = kstNow();
  const prev = prevYm(year, month);
  const d = await withUser(me.id, async (tx) => {
    const reports = await tx`select id, year, month, status, reject_reason, updated_at from monthly_reports where user_id = ${me.id} order by year desc, month desc limit 12`;
    const cur = reports.find((r) => r.year === year && r.month === month) ?? null;
    // 금월 업무: 보고 항목 + 개발과제 월별 기록 + 개발현황 + 생산이관
    const [c] = await tx`
      with w as (
        select i.status::text as s from report_items i join monthly_reports r on r.id = i.report_id where r.user_id = ${me.id} and r.year = ${year} and r.month = ${month}
        union all select m.status::text from dev_project_monthly m join monthly_reports r on r.id = m.report_id where r.user_id = ${me.id} and r.year = ${year} and r.month = ${month}
        union all select d.status::text from dev_works d where d.user_id = ${me.id} and d.year = ${year} and d.month = ${month}
        union all select t.transfer_status::text from transfers t where t.user_id = ${me.id} and t.year = ${year} and t.month = ${month}
      )
      select count(*) as total, count(*) filter (where s = 'done') as done,
             count(*) filter (where s = 'in_progress') as in_progress, count(*) filter (where s = 'on_hold') as on_hold from w`;
    const notices = await tx`select id, title, body, link, is_read, created_at from notifications order by created_at desc limit 5`;
    const pending = me.role === 'admin' ? await tx`select count(*) as n from monthly_reports where status = 'submitted'` : [{ n: 0 }];
    return { reports, cur, c, notices, pending: pending[0].n as number };
  });
  const rejected = d.reports.filter((r) => r.status === 'rejected');
  const prevReport = d.reports.find((r) => r.year === prev.year && r.month === prev.month);
  const stat = (label: string, n: number, cls: string) => (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${cls}`}>{n}<span className="ml-1 text-sm font-medium text-slate-500">건</span></div>
    </div>
  );
  return (
    <div>
      <PageHeader title={`${me.name}님의 대시보드`} desc={`${year}년 ${month}월 기준 (한국시간)`} />
      {sp.denied && <div role="alert" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">관리자만 볼 수 있는 화면입니다.</div>}
      {rejected.map((r) => (
        <div key={r.id} role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <span><b>{r.year}년 {r.month}월 월차보고가 반려되었습니다.</b> 사유: {r.reject_reason}</span>
          <Link href={`/reports/${r.id}`}><Button size="sm" variant="danger">수정하고 재제출</Button></Link>
        </div>
      ))}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-5 lg:col-span-1">
          <div className="text-xs font-semibold text-blue-900">금월 보고서 ({year}년 {month}월)</div>
          <div className="mt-2 flex items-center gap-2"><ReportBadge status={(d.cur?.status as ReportStatus) ?? null} />{d.cur && <span className="text-xs text-slate-600">수정 {fmtDateTime(d.cur.updated_at)}</span>}</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={d.cur ? `/reports/${d.cur.id}` : `/reports/write?year=${year}&month=${month}`}><Button variant="primary">{d.cur ? (['draft', 'rejected'].includes(d.cur.status) ? '이어서 작성' : '보고서 보기') : '월차보고 작성'}</Button></Link>
            <Link href={`/dev-status?year=${year}&month=${month}&tab=detail`}><Button>개발현황 기록</Button></Link>
            <Link href={`/transfers?year=${year}&month=${month}&tab=detail`}><Button>생산이관 기록</Button></Link>
          </div>
          {!prevReport && <p className="mt-3 text-xs text-blue-900">전월({prev.year}년 {prev.month}월) 보고서가 없습니다. <Link className="underline" href={`/reports/write?year=${prev.year}&month=${prev.month}`}>전월 보고서 작성</Link></p>}
        </div>
        <div className="grid grid-cols-2 gap-4 lg:col-span-2 lg:grid-cols-4">
          {stat('금월 전체 업무', d.c.total, 'text-slate-900')}
          {stat('완료', d.c.done, 'text-emerald-700')}
          {stat('진행중', d.c.in_progress, 'text-blue-700')}
          {stat('보류', d.c.on_hold, 'text-amber-700')}
        </div>
      </div>
      {me.role === 'admin' && d.pending > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <span>검토를 기다리는 제출 보고서가 <b>{d.pending}건</b> 있습니다.</span>
          <Link href="/admin/reports"><Button size="sm">월차보고 관리로 이동</Button></Link>
        </div>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="최근 보고서" pad={false} actions={<Link href="/reports" className="text-xs text-blue-700 hover:underline">전체 내역 →</Link>}>
          {d.reports.length === 0 ? <p className="p-4 text-sm text-slate-500">작성한 보고서가 없습니다.</p> : (
            <ul className="divide-y divide-slate-100">
              {d.reports.slice(0, 6).map((r) => (
                <li key={r.id}><Link href={`/reports/${r.id}`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-50">
                  <span className="font-medium text-slate-800">{r.year}년 {r.month}월</span>
                  <span className="flex items-center gap-3"><span className="text-xs text-slate-500">{fmtDateTime(r.updated_at)}</span><span className="sr-only">{REPORT_STATUS[r.status as ReportStatus].label}</span><ReportBadge status={r.status} /></span>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="최근 알림" pad={false}>
          {d.notices.length === 0 ? <p className="p-4 text-sm text-slate-500">알림이 없습니다.</p> : (
            <ul className="divide-y divide-slate-100">
              {d.notices.map((n) => (
                <li key={n.id}><Link href={n.link || '/dashboard'} className="block px-4 py-2.5 hover:bg-slate-50">
                  <div className={`text-sm ${n.is_read ? 'text-slate-600' : 'font-medium text-slate-900'}`}>{n.title}</div>
                  {n.body && <div className="truncate text-xs text-slate-500">{n.body}</div>}
                  <div className="text-[11px] text-slate-400">{fmtDateTime(n.created_at)}</div>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
