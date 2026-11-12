// 관리자 월차보고 관리: 직원별 제출 상태, 보고서 열기·검토, 전체 취합 출력,
// 개발현황·생산이관 24개월 타임라인에서 선택한 월의 상태 직접 수정
import { requireAdmin } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { kstNow, parseIntParam } from '@/lib/constants';
import { loadTimeline } from '@/lib/data';
import { AdminReports } from '@/components/reports/AdminReports';

export const dynamic = 'force-dynamic';

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const now = kstNow();
  const year = parseIntParam(sp.year, now.year, 2000, 2100);
  const month = parseIntParam(sp.month, now.month, 1, 12);
  const d = await withUser(me.id, async (tx) => {
    const staff = await tx`
      select p.id, p.name, p.role, p.is_active,
             r.id as report_id, r.status, r.submitted_at, r.updated_at, r.reject_reason,
             (select count(*) from dev_works d where d.user_id = p.id and d.year = ${year} and d.month = ${month}) as dev_count,
             (select count(*) from transfers t where t.user_id = p.id and t.year = ${year} and t.month = ${month}) as transfer_count,
             (select count(*) from report_items i where i.report_id = r.id) + (select count(*) from dev_project_monthly m where m.report_id = r.id) as item_count
      from profiles p left join monthly_reports r on r.user_id = p.id and r.year = ${year} and r.month = ${month}
      where p.is_active or r.id is not null
      order by p.name`;
    return { staff, dev: await loadTimeline(tx, 'dev', year), transfer: await loadTimeline(tx, 'transfer', year) };
  });
  return <AdminReports year={year} month={month} staff={d.staff as never} dev={d.dev} transfer={d.transfer} />;
}
