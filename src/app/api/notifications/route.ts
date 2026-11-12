import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { uuid } from '@/lib/validate';

export const GET = route({}, async ({ db }) => {
  return db(async (tx) => {
    const items = await tx`select id, title, body, link, is_read, created_at from notifications order by created_at desc limit 30`;
    const [c] = await tx`select count(*) as n from notifications where not is_read`;
    return { items, unread: c.n };
  });
});

export const POST = route({}, async ({ db, req }) => {
  const body = await readJson(req);
  if (body.action === 'read') {
    const id = uuid(body.id);
    await db((tx) => tx`update notifications set is_read = true where id = ${id}`);
  } else if (body.action === 'read_all') {
    await db((tx) => tx`update notifications set is_read = true where not is_read`);
  } else throw new HttpError(400, '알 수 없는 요청입니다.');
  return { ok: true };
});
