// 개별 매출내역: 월별 조회 / 직접 추가 (관리자 전용)
import { route, readJson } from '@/lib/auth';
import { kstNow } from '@/lib/constants';
import { int } from '@/lib/validate';
import { listSales, salesMonthSummary, dropStaleClosings } from '@/lib/sales-data';
import { parseSaleBody, ymOf } from './_shared';

export const GET = route({ admin: true }, async ({ req, db }) => {
  const q = req.nextUrl.searchParams;
  const now = kstNow();
  const year = q.get('year') === null ? now.year : int(q.get('year'), 2000, 2100, '연도');
  const month = q.get('month') === null ? now.month : int(q.get('month'), 1, 12, '월');
  return db(async (tx) => {
    const rows = await listSales(tx, year, month);
    const summary = await salesMonthSummary(tx, year, month);
    return { year, month, rows, summary };
  });
});

export const POST = route({ admin: true }, async ({ user, req, db }) => {
  const v = parseSaleBody(await readJson(req));
  return db(async (tx) => {
    const [row] = await tx`
      insert into sales (sale_date, kind, customer, product_name, model, manager, quantity, unit, unit_price, currency, exchange_rate,
                         supply_amount, vat_amount, total_amount, note, created_by)
      values (${v.sale_date}, ${v.kind}, ${v.customer}, ${v.product_name}, ${v.model}, ${v.manager}, ${v.quantity}, ${v.unit}, ${v.unit_price},
              ${v.currency}, ${v.exchange_rate}, ${v.supply_amount}, ${v.vat_amount}, ${v.total_amount}, ${v.note}, ${user.id})
      returning id, sale_date, version`;
    await dropStaleClosings(tx, [ymOf(v.sale_date)]);
    return { ok: true, id: row.id, sale_date: row.sale_date, version: row.version };
  });
});
