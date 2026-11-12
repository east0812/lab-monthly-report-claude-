// 연간 그래프 탭 (서버 컴포넌트). SVG 는 src/lib/charts.ts 가 이스케이프해서 만든 문자열만 넣는다.
import Link from 'next/link';
import { Card, YearMonthNav } from '@/components/ui';
import { fmtNum } from '@/lib/constants';
import { monthlyCompareChart, yearlyChart } from '@/lib/charts';
import { fmtUnitQty, type SalesMonth, type SalesYear, type UnitQty } from '@/lib/sales-data';
import { Money, MonthState } from './parts';

const th = 'border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 whitespace-nowrap';
const td = 'border-b border-slate-100 px-3 py-2 text-sm text-slate-800 whitespace-nowrap';
const num = `${td} text-right tabular-nums`;

function sumQty(list: UnitQty[][]): UnitQty[] {
  const map = new Map<string, number>();
  for (const l of list) for (const q of l) map.set(q.unit, (map.get(q.unit) ?? 0) + q.qty);
  return [...map].map(([unit, qty]) => ({ unit, qty })).sort((a, b) => a.unit.localeCompare(b.unit, 'ko'));
}
function growthText(g: number | null): string {
  if (g === null) return '-';
  return `${g > 0 ? '▲ +' : g < 0 ? '▼ ' : ''}${fmtNum(g, 1)}%`;
}

export function SalesCharts({ year, current, previous, fiveYears }: { year: number; current: SalesMonth[]; previous: SalesMonth[]; fiveYears: SalesYear[] }) {
  const monthly = monthlyCompareChart({ year, current: current.map((m) => m.total), previous: previous.map((m) => m.total), width: 860, height: 330 });
  const yearly = yearlyChart({ years: fiveYears.map((y) => ({ year: y.year, total: y.total, growth: y.growth })), width: 860, height: 320 });
  const anyCur = current.some((m) => m.registered);
  const anyPrev = previous.some((m) => m.registered);
  const totalCur = anyCur ? current.reduce((s, m) => s + (m.total ?? 0), 0) : null;
  const totalPrev = anyPrev ? previous.reduce((s, m) => s + (m.total ?? 0), 0) : null;
  const unregistered = current.filter((m) => !m.registered).map((m) => `${m.month}월`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <YearMonthNav year={year} withMonth={false} />
        <span className="text-sm text-slate-600">
          {year}년 총금액 <strong className="text-slate-900"><Money v={totalCur} /></strong>
          <span className="mx-2 text-slate-300">|</span>
          전년 <Money v={totalPrev} />
        </span>
      </div>

      <Card title={`${year}년 월별 매출 추이 (전년 비교)`}>
        <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: monthly }} />
        <p className="mt-2 text-xs text-slate-500">
          빈 표식과 &quot;미등록&quot;은 매출 자료가 아직 없는 달입니다. 매출이 실제로 없는 달은 개별 매출내역에서 &quot;0원 확정&quot;을 하면 0으로 표시됩니다.
          {unregistered.length > 0 && <> {year}년 미등록: {unregistered.join(', ')}</>}
        </p>
      </Card>

      <Card title={`${year}년 월별 집계`} pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th scope="col" className={`${th} text-left`}>월</th>
                <th scope="col" className={`${th} text-right`}>건수</th>
                <th scope="col" className={`${th} text-left`}>단위별 수량</th>
                <th scope="col" className={`${th} text-right`}>총금액(부가세 포함)</th>
                <th scope="col" className={`${th} text-right`}>전년 동월 총금액</th>
                <th scope="col" className={`${th} text-left`}>상태</th>
              </tr>
            </thead>
            <tbody>
              {current.map((m, i) => (
                <tr key={m.month}>
                  <td className={td}>
                    <Link className="text-blue-700 hover:underline" href={`/admin/sales?year=${year}&month=${m.month}&tab=list`}>{m.month}월</Link>
                  </td>
                  <td className={num}>{m.registered ? fmtNum(m.count) : '-'}</td>
                  <td className={td}>{fmtUnitQty(m.qty)}</td>
                  <td className={num}><Money v={m.total} /></td>
                  <td className={num}><Money v={previous[i]?.total ?? null} /></td>
                  <td className={td}><MonthState m={m} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td className={td}>합계</td>
                <td className={num}>{fmtNum(current.reduce((s, m) => s + m.count, 0))}</td>
                <td className={td}>{fmtUnitQty(sumQty(current.map((m) => m.qty)))}</td>
                <td className={num}><Money v={totalCur} /></td>
                <td className={num}><Money v={totalPrev} /></td>
                <td className={td}>등록 {current.filter((m) => m.registered).length} / 12개월</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card title={`최근 5개년 총금액 (${year - 4}~${year}년)`}>
        <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: yearly }} />
        <p className="mt-2 text-xs text-slate-500">증감률은 직전년도 총금액 대비이며, 직전년도 자료가 없거나 0원 이하이면 계산하지 않고 &quot;-&quot;로 표시합니다.</p>
      </Card>

      <Card title="연도별 집계" pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th scope="col" className={`${th} text-left`}>연도</th>
                <th scope="col" className={`${th} text-right`}>총금액(부가세 포함)</th>
                <th scope="col" className={`${th} text-left`}>단위별 수량</th>
                <th scope="col" className={`${th} text-right`}>등록 월수</th>
                <th scope="col" className={`${th} text-right`}>직전년도 대비 증감률</th>
              </tr>
            </thead>
            <tbody>
              {fiveYears.map((y) => (
                <tr key={y.year}>
                  <td className={td}><Link className="text-blue-700 hover:underline" href={`/admin/sales?year=${y.year}&tab=chart`}>{y.year}년</Link></td>
                  <td className={num}><Money v={y.total} /></td>
                  <td className={td}>{fmtUnitQty(y.qty)}</td>
                  <td className={num}>{y.registeredMonths} / 12</td>
                  <td className={`${num} ${y.growth === null ? 'text-slate-400' : y.growth > 0 ? 'text-emerald-700' : y.growth < 0 ? 'text-rose-700' : ''}`}>{growthText(y.growth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
