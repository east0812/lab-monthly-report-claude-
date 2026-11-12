// 월차보고 작성: 선택한 연·월의 내 보고서가 있으면 바로 열고, 없으면 작성 시작 화면을 보여 준다.
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { kstNow, parseIntParam } from '@/lib/constants';
import { ReportStart } from '@/components/reports/ReportList';

export const dynamic = 'force-dynamic';

export default async function WritePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const now = kstNow();
  const year = parseIntParam(sp.year, now.year, 2000, 2100);
  const month = parseIntParam(sp.month, now.month, 1, 12);
  const explicit = sp.year !== undefined || sp.month !== undefined;
  const rows = await withUser(me.id, (tx) => tx`
    select id, year, month, status from monthly_reports where user_id = ${me.id} order by year desc, month desc limit 24`);
  const existing = rows.find((r) => r.year === year && r.month === month);
  if (existing && !explicit) redirect(`/reports/${existing.id}`);
  return <ReportStart year={year} month={month} existingId={existing?.id ?? null} recent={rows.map((r) => ({ id: r.id, year: r.year, month: r.month, status: r.status }))} />;
}
