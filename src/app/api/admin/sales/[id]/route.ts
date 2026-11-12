// 매출 한 건 수정 (관리자 전용). version 으로 동시 수정 충돌을 막는다.
// 가져오기 추적 정보와 원본 금액(orig_*)은 DB 트리거가 그대로 보존한다.
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { uuid, int } from '@/lib/validate';
import { dropStaleClosings } from '@/lib/sales-data';
import { parseSaleBody, ymOf } from '../_shared';

export const PATCH = route({ admin: true }, async ({ req, params, db }) => {
  const id = uuid(params.id);
  const body = await readJson(req);
  const version = int(body.version, 1, 2147483647, '버전');
  const v = parseSaleBody(body);
  return db(async (tx) => {
    const rows = await tx`
      update sales set sale_date = ${v.sale_date}, kind = ${v.kind}, customer = ${v.customer}, product_name = ${v.product_name},
             model = ${v.model}, manager = ${v.manager}, quantity = ${v.quantity}, unit = ${v.unit}, unit_price = ${v.unit_price},
             currency = ${v.currency}, exchange_rate = ${v.exchange_rate}, supply_amount = ${v.supply_amount},
             vat_amount = ${v.vat_amount}, total_amount = ${v.total_amount}, note = ${v.note}
       where id = ${id} and version = ${version}
      returning id, sale_date, version, is_edited`;
    if (!rows.length) {
      const [exists] = await tx`select 1 as ok from sales where id = ${id}`;
      if (!exists) throw new HttpError(404, '거래를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.');
      throw new HttpError(409, '다른 화면에서 먼저 수정되었습니다. 새로 고친 뒤 다시 시도해 주세요.');
    }
    await dropStaleClosings(tx, [ymOf(v.sale_date)]);
    return { ok: true, id, sale_date: rows[0].sale_date, version: rows[0].version, is_edited: rows[0].is_edited };
  });
});
