// 매출 없는 달을 "0원 확정" / 확정 해제 (관리자 전용). 미등록과 실제 0원을 구분하는 기록.
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { int, oneOf, str } from '@/lib/validate';
import { salesMonthSummary } from '@/lib/sales-data';

export const POST = route({ admin: true }, async ({ user, req, db }) => {
  const body = await readJson(req);
  const year = int(body.year, 2000, 2100, '연도');
  const month = int(body.month, 1, 12, '월');
  const action = oneOf(body.action, ['confirm', 'clear'] as const, '요청');
  const note = str(body.note, 200, '메모');
  return db(async (tx) => {
    if (action === 'confirm') {
      const [c] = await tx`select count(*) as n from sales where year = ${year} and month = ${month}`;
      if (Number(c.n) > 0) throw new HttpError(409, '거래가 등록된 달은 0원으로 확정할 수 없습니다.');
      await tx`
        insert into sales_closings (year, month, note, confirmed_by) values (${year}, ${month}, ${note}, ${user.id})
        on conflict (year, month) do update set note = excluded.note, confirmed_by = excluded.confirmed_by, confirmed_at = now()`;
    } else {
      await tx`delete from sales_closings where year = ${year} and month = ${month}`;
    }
    return { ok: true, summary: await salesMonthSummary(tx, year, month) };
  });
});
