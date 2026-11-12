// 업무분류 관리: 목록, 추가 (관리자 전용)
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { listCategories } from '@/lib/data';
import { int, reqStr } from '@/lib/validate';

export const GET = route({ admin: true }, async ({ db }) => {
  const categories = await db((tx) => listCategories(tx, true));
  return { categories };
});

export const POST = route({ admin: true }, async ({ db, req }) => {
  const body = await readJson(req);
  const name = reqStr(body.name, 50, '이름');
  const sortOrder = body.sort_order === undefined || body.sort_order === '' ? 0 : int(body.sort_order, 0, 9999, '정렬 순서');
  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') throw new HttpError(400, '사용 여부: 값이 올바르지 않습니다.');
  const isActive = body.is_active !== false;
  try {
    const [c] = await db((tx) => tx`
      insert into work_categories (name, sort_order, is_active) values (${name}, ${sortOrder}, ${isActive})
      returning id, name, sort_order, is_active`);
    return { category: c };
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') throw new HttpError(409, '같은 이름의 업무분류가 이미 있습니다.');
    throw e;
  }
});
