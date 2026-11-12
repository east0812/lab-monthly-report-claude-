// 개발현황 상세 업무: 수정(낙관적 잠금) · 삭제
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { optUuid, uuid } from '@/lib/validate';
import {
  CONFLICT_MSG, LOCK_MSG, NOT_FOUND_MSG, NOT_OWNER_MSG,
  assertCategory, assertProduct, getDevWork, monthSubmitted, parseDevWorkInput, resolveOwner, throwWriteMiss, versionOf,
} from '../_shared';

export const PATCH = route({}, async ({ user, req, params, db }) => {
  const id = uuid(params.id);
  const body = await readJson(req);
  const version = versionOf(body.version);
  const input = parseDevWorkInput(body, true);
  const isAdmin = user.role === 'admin';
  return db(async (tx) => {
    const [cur] = await tx`select user_id, year, month, product_id, category_id, version from dev_works where id = ${id}`;
    if (!cur) throw new HttpError(404, NOT_FOUND_MSG);
    if (!isAdmin) {
      if (cur.user_id !== user.id) throw new HttpError(403, NOT_OWNER_MSG);
      if (await monthSubmitted(tx, cur.user_id, cur.year, cur.month)) throw new HttpError(403, LOCK_MSG);
    }
    if (cur.version !== version) throw new HttpError(409, CONFLICT_MSG);

    const patch: Record<string, string | number | null> = { ...input };
    // 담당자 변경은 관리자만. 직원의 기록은 항상 본인 것으로 유지된다.
    if (isAdmin && body.user_id !== undefined) {
      const next = optUuid(body.user_id, '담당자');
      if (next && next !== cur.user_id) patch.user_id = await resolveOwner(tx, user, next);
    }
    if (input.product_id !== undefined && input.product_id !== cur.product_id) await assertProduct(tx, input.product_id, cur.product_id);
    if (input.category_id && input.category_id !== cur.category_id) await assertCategory(tx, input.category_id, cur.category_id);
    if (Object.keys(patch).length === 0) throw new HttpError(400, '변경할 내용이 없습니다.');

    // 화면이 본 버전과 같을 때만 반영한다 (오래된 화면의 덮어쓰기 방지). 버전은 DB 트리거가 올린다.
    const rows = await tx`update dev_works set ${tx(patch)} where id = ${id} and version = ${version} returning id`;
    if (rows.length === 0) await throwWriteMiss(tx, 'dev_works', id, version, user);
    return { work: await getDevWork(tx, id) };
  });
});

export const DELETE = route({}, async ({ user, req, params, db }) => {
  const id = uuid(params.id);
  const raw = req.nextUrl.searchParams.get('version');
  const version = raw === null ? null : versionOf(raw);
  return db(async (tx) => {
    const rows = version === null
      ? await tx`delete from dev_works where id = ${id} returning id`
      : await tx`delete from dev_works where id = ${id} and version = ${version} returning id`;
    if (rows.length === 0) await throwWriteMiss(tx, 'dev_works', id, version, user);
    return { ok: true };
  });
});
