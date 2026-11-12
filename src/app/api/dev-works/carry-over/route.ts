// 전월 업무 이월 실행: DB 함수 carry_over_dev_works 가 대상 확인·중복 방지를 맡는다.
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { uuid } from '@/lib/validate';
import { LOCK_MSG, monthSubmitted, periodFromBody } from '../_shared';

export const POST = route({}, async ({ user, req, db }) => {
  const body = await readJson(req);
  const { year, month } = periodFromBody(body);
  if (!Array.isArray(body.ids) || body.ids.length === 0) throw new HttpError(400, '이월할 업무를 선택해 주세요.');
  if (body.ids.length > 200) throw new HttpError(400, '한 번에 200건까지 이월할 수 있습니다.');
  const ids = [...new Set(body.ids.map((v: unknown) => uuid(v, '업무')))];
  return db(async (tx) => {
    if (user.role !== 'admin' && (await monthSubmitted(tx, user.id, year, month))) throw new HttpError(403, LOCK_MSG);
    const [r] = await tx`select created, skipped from carry_over_dev_works(${ids}::uuid[], ${year}, ${month})`;
    return { created: Number(r.created), skipped: Number(r.skipped) };
  });
});
