// 연구소 매출현황 (관리자 전용): 개별 매출내역 / 연간 그래프
import { requireAdmin } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { kstNow, parseIntParam } from '@/lib/constants';
import { listSales, salesYearSummary, salesFiveYears } from '@/lib/sales-data';
import { PageHeader } from '@/components/ui';
import { SalesTabs } from '@/components/sales/SalesTabs';
import { SalesList } from '@/components/sales/SalesList';
import { SalesCharts } from '@/components/sales/SalesCharts';

export const dynamic = 'force-dynamic';

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const now = kstNow();
  const year = parseIntParam(sp.year, now.year, 2015, now.year + 1);
  const month = parseIntParam(sp.month, now.month, 1, 12);
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) === 'chart' ? 'chart' : 'list';

  return (
    <div>
      <PageHeader title="연구소 매출현황" desc="관리자만 볼 수 있습니다. 모든 합계는 부가세 포함 총금액 기준이며, 수량은 단위별로 따로 집계합니다." />
      <SalesTabs tab={tab} />
      {tab === 'list' ? <ListTab uid={me.id} year={year} month={month} /> : <ChartTab uid={me.id} year={year} />}
    </div>
  );
}

async function ListTab({ uid, year, month }: { uid: string; year: number; month: number }) {
  const data = await withUser(uid, async (tx) => {
    const rows = await listSales(tx, year, month);
    const months = await salesYearSummary(tx, year);
    return { rows, summary: months[month - 1] };
  });
  return <SalesList key={`${year}-${month}`} year={year} month={month} rows={data.rows} summary={data.summary} />;
}

async function ChartTab({ uid, year }: { uid: string; year: number }) {
  const data = await withUser(uid, async (tx) => {
    const current = await salesYearSummary(tx, year);
    const previous = await salesYearSummary(tx, year - 1);
    const fiveYears = await salesFiveYears(tx, year);
    return { current, previous, fiveYears };
  });
  return <SalesCharts year={year} current={data.current} previous={data.previous} fiveYears={data.fiveYears} />;
}
