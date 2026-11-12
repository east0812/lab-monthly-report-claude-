// 매출 일괄 삭제 (관리자 전용). 한 트랜잭션·한 문장으로 지우고, 하나라도 못 지우면 전부 되돌린다.
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { uuid } from '@/lib/validate';

const MAX = 2000;

export const POST = route({ admin: true }, async ({ req, db }) => {
  const body = await readJson(req);
  if (!Array.isArray(body.ids) || body.ids.length === 0) throw new HttpError(400, '삭제할 거래를 선택해 주세요.');
  if (body.ids.length > MAX) throw new HttpError(400, `한 번에 ${MAX.toLocaleString()}건까지 삭제할 수 있습니다.`);
  const ids = [...new Set(body.ids.map((v) => uuid(v, '거래 식별자')))];
  return db(async (tx) => {
    const gone = await tx`delete from sales where id = any(${ids}::uuid[]) returning id`;
    if (gone.length !== ids.length) {
      // 예외를 던지면 트랜잭션 전체가 취소된다 → 일부만 지워지는 일이 없다.
      throw new HttpError(409, `선택한 ${ids.length}건 중 ${ids.length - gone.length}건을 찾을 수 없어 아무것도 삭제하지 않았습니다. 새로 고친 뒤 다시 시도해 주세요.`);
    }
    return { ok: true, deleted: gone.length };
  });
});
