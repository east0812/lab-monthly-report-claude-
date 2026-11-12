// 제품 Revision 변경 이력 (관리자 전용)
import { route } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { uuid } from '@/lib/validate';

export const GET = route({ admin: true }, async ({ db, params }) => {
  const id = uuid(params.id, '제품');
  return db(async (tx) => {
    const [p] = await tx`select id, name, model, revision from products where id = ${id}`;
    if (!p) throw new HttpError(404, '제품을 찾을 수 없습니다.');
    const revisions = await tx`
      select r.id, r.revision, r.prev_revision, user_name(r.changed_by) as changed_by_name, r.changed_at
      from product_revisions r where r.product_id = ${id}
      order by r.changed_at desc, r.id`;
    return { product: p, revisions };
  });
});
