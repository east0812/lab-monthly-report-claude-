// 업무분류 수정 / 삭제 (관리자 전용). 삭제하면 이 분류를 쓰던 기록의 분류만 비워진다(FK on delete set null).
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { int, reqStr, uuid } from '@/lib/validate';

export const PATCH = route({ admin: true }, async ({ db, req, params }) => {
  const id = uuid(params.id, '업무분류');
  const body = await readJson(req);
  const name = body.name === undefined ? null : reqStr(body.name, 50, '이름');
  const sortOrder = body.sort_order === undefined ? null : int(body.sort_order, 0, 9999, '정렬 순서');
  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') throw new HttpError(400, '사용 여부: 값이 올바르지 않습니다.');
  const isActive = body.is_active === undefined ? null : (body.is_active as boolean);
  if (name === null && sortOrder === null && isActive === null) throw new HttpError(400, '변경할 내용이 없습니다.');
  try {
    const [c] = await db((tx) => tx`
      update work_categories set
        name = coalesce(${name}, name),
        sort_order = coalesce(${sortOrder}, sort_order),
        is_active = coalesce(${isActive}, is_active)
      where id = ${id}
      returning id, name, sort_order, is_active`);
    if (!c) throw new HttpError(404, '업무분류를 찾을 수 없습니다.');
    return { category: c };
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') throw new HttpError(409, '같은 이름의 업무분류가 이미 있습니다.');
    throw e;
  }
});

export const DELETE = route({ admin: true }, async ({ db, params }) => {
  const id = uuid(params.id, '업무분류');
  const rows = await db((tx) => tx`delete from work_categories where id = ${id} returning id`);
  if (!rows.length) throw new HttpError(404, '업무분류를 찾을 수 없습니다.');
  return { ok: true };
});
