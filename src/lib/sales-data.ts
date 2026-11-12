// 매출 집계·조회 (관리자 전용 화면과 연구소 현황·내보내기에서 함께 쓴다)
// 모든 함수는 RLS 가 적용된 트랜잭션 tx 를 받는다. 금액은 부가세 포함 총금액(total_amount) 기준.
// 수량은 단위별로만 합산한다 (단위·수량이 빈 운임 등은 수량 합계에서 제외).
import type { Tx } from './db';

export type UnitQty = { unit: string; qty: number };
export type SalesMonth = {
  year: number; month: number;
  /** 매출 행이 있거나 "0원 확정"된 달 */
  registered: boolean;
  /** 매출 행 없이 0원으로 확정된 달 */
  zeroConfirmed: boolean;
  count: number;
  supply: number | null; vat: number | null; total: number | null;
  qty: UnitQty[];
};
export type SalesYear = { year: number; total: number | null; registeredMonths: number; growth: number | null; qty: UnitQty[] };

export type SaleRow = {
  id: string; sale_date: string; kind: 'sale' | 'return' | 'freight' | 'misc';
  customer: string; product_name: string; model: string; manager: string;
  quantity: number | null; unit: string; unit_price: number | null;
  currency: string; exchange_rate: number;
  supply_amount: number; vat_amount: number; total_amount: number; note: string;
  import_key: string | null; import_id: string | null;
  source_file: string | null; source_sheet: string | null; source_row: number | null;
  orig_supply_amount: number | null; orig_vat_amount: number | null; orig_total_amount: number | null;
  is_edited: boolean; version: number; created_at: string; updated_at: string;
};

/** (cur - prev) / prev * 100. cur·prev 가 없거나 prev 가 0 이하면 계산하지 않는다(null). */
export function growthRate(cur: number | null, prev: number | null): number | null {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

const sortQty = (list: UnitQty[]) => list.sort((a, b) => a.unit.localeCompare(b.unit, 'ko'));

/** 해당 연도 1~12월 요약 (12개). 미등록 달은 금액이 null, 0원 확정 달은 0. */
export async function salesYearSummary(tx: Tx, year: number): Promise<SalesMonth[]> {
  const sums = await tx`
    select month, count(*) as n, sum(supply_amount) as supply, sum(vat_amount) as vat, sum(total_amount) as total
      from sales where year = ${year} group by month`;
  const qtys = await tx`
    select month, btrim(unit) as unit, sum(quantity) as qty
      from sales where year = ${year} and btrim(unit) <> '' and quantity is not null group by month, btrim(unit)`;
  const closings = await tx`select month from sales_closings where year = ${year}`;
  const closed = new Set<number>(closings.map((c) => Number(c.month)));
  const out: SalesMonth[] = [];
  for (let m = 1; m <= 12; m++) {
    const s = sums.find((r) => Number(r.month) === m);
    const count = s ? Number(s.n) : 0;
    const zeroConfirmed = count === 0 && closed.has(m);
    const registered = count > 0 || zeroConfirmed;
    out.push({
      year, month: m, registered, zeroConfirmed, count,
      supply: count > 0 ? Number(s!.supply) : zeroConfirmed ? 0 : null,
      vat: count > 0 ? Number(s!.vat) : zeroConfirmed ? 0 : null,
      total: count > 0 ? Number(s!.total) : zeroConfirmed ? 0 : null,
      qty: sortQty(qtys.filter((q) => Number(q.month) === m).map((q) => ({ unit: String(q.unit), qty: Number(q.qty) }))),
    });
  }
  return out;
}

/** year-4 … year (오름차순 5개). 등록된 달이 하나도 없는 해는 total null. 증감률은 직전년도 대비. */
export async function salesFiveYears(tx: Tx, year: number): Promise<SalesYear[]> {
  const from = year - 5; // 첫 해의 증감률 계산용으로 한 해 더 읽는다
  const sums = await tx`
    select year, month, sum(total_amount) as total
      from sales where year between ${from} and ${year} group by year, month`;
  const qtys = await tx`
    select year, btrim(unit) as unit, sum(quantity) as qty
      from sales where year between ${from} and ${year} and btrim(unit) <> '' and quantity is not null group by year, btrim(unit)`;
  const closings = await tx`select year, month from sales_closings where year between ${from} and ${year}`;
  const stat = (y: number) => {
    const months = new Set<number>();
    let total = 0;
    for (const r of sums) if (Number(r.year) === y) { months.add(Number(r.month)); total += Number(r.total); }
    for (const c of closings) if (Number(c.year) === y) months.add(Number(c.month));
    return { total: months.size > 0 ? total : null, registeredMonths: months.size };
  };
  const out: SalesYear[] = [];
  let prev = stat(from).total;
  for (let y = year - 4; y <= year; y++) {
    const s = stat(y);
    out.push({
      year: y, total: s.total, registeredMonths: s.registeredMonths, growth: growthRate(s.total, prev),
      qty: sortQty(qtys.filter((q) => Number(q.year) === y).map((q) => ({ unit: String(q.unit), qty: Number(q.qty) }))),
    });
    prev = s.total;
  }
  return out;
}

/** 한 달 요약 */
export async function salesMonthSummary(tx: Tx, year: number, month: number): Promise<SalesMonth> {
  const all = await salesYearSummary(tx, year);
  return all[month - 1];
}

/** 한 달 개별 매출내역 (납품일 → 원본 행 순) */
export async function listSales(tx: Tx, year: number, month: number): Promise<SaleRow[]> {
  const rows = await tx`
    select id, sale_date, kind, customer, product_name, model, manager, quantity, unit, unit_price, currency, exchange_rate,
           supply_amount, vat_amount, total_amount, note, import_key, import_id, source_file, source_sheet, source_row,
           orig_supply_amount, orig_vat_amount, orig_total_amount, is_edited, version, created_at, updated_at
      from sales where year = ${year} and month = ${month}
     order by sale_date, source_row nulls last, created_at, id`;
  return rows as unknown as SaleRow[];
}

/** 거래가 생긴 달의 "0원 확정" 기록은 더 이상 맞지 않으므로 지운다. */
export async function dropStaleClosings(tx: Tx, months: { year: number; month: number }[]): Promise<void> {
  for (const m of months) {
    await tx`delete from sales_closings c where c.year = ${m.year} and c.month = ${m.month}
      and exists (select 1 from sales s where s.year = c.year and s.month = c.month)`;
  }
}

/** 단위별 수량을 "120 EA · 5 SET" 처럼 한 줄로 */
export function fmtUnitQty(list: UnitQty[]): string {
  if (!list.length) return '-';
  return list.map((q) => `${Number(q.qty).toLocaleString('ko-KR', { maximumFractionDigits: 4 })} ${q.unit}`).join(' · ');
}
