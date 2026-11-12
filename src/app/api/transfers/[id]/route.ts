// 생산이관 기록: 수정(낙관적 잠금) · 삭제
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { optUuid, uuid } from '@/lib/validate';
import {
  CONFLICT_MSG, LOCK_MSG, NOT_FOUND_MSG, NOT_OWNER_MSG,
  assertProduct, getTransfer, monthSubmitted, parseTransferInput, resolveOwner, throwWriteMiss, versionOf,
} from '../../dev-works/_shared';

export const PATCH = route({}, async ({ user, req, params, db }) => {
  const id = uuid(params.id);
  const body = await readJson(req);
  const version = versionOf(body.version);
  const input = parseTransferInput(body, true);
  const isAdmin = user.role === 'admin';
  return db(async (tx) => {
    const [cur] = await tx`select user_id, year, month, product_id, version from transfers where id = ${id}`;
    if (!cur) throw new HttpError(404, NOT_FOUND_MSG);
    if (!isAdmin) {
      if (cur.user_id !== user.id) throw new HttpError(403, NOT_OWNER_MSG);
      if (await monthSubmitted(tx, cur.user_id, cur.year, cur.month)) throw new HttpError(403, LOCK_MSG);
    }
    if (cur.version !== version) throw new HttpError(409, CONFLICT_MSG);

    const patch: Record<string, string | number | null> = { ...input };
    if (isAdmin && body.user_id !== undefined) {
      const next = optUuid(body.user_id, '담당자');
      if (next && next !== cur.user_id) patch.user_id = await resolveOwner(tx, user, next);
    }
    if (input.product_id !== undefined && input.product_id !== cur.product_id) await assertProduct(tx, input.product_id, cur.product_id);
    if (Object.keys(patch).length === 0) throw new HttpError(400, '변경할 내용이 없습니다.');

    const rows = await tx`update transfers set ${tx(patch)} where id = ${id} and version = ${version} returning id`;
    if (rows.length === 0) await throwWriteMiss(tx, 'transfers', id, version, user);
    return { transfer: await getTransfer(tx, id) };
  });
});

export const DELETE = route({}, async ({ user, req, params, db }) => {
  const id = uuid(params.id);
  const raw = req.nextUrl.searchParams.get('version');
  const version = raw === null ? null : versionOf(raw);
  return db(async (tx) => {
    const rows = version === null
      ? await tx`delete from transfers where id = ${id} returning id`
      : await tx`delete from transfers where id = ${id} and version = ${version} returning id`;
    if (rows.length === 0) await throwWriteMiss(tx, 'transfers', id, version, user);
    return { ok: true };
  });
});
