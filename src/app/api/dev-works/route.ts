// 개발현황 상세 업무: 목록 조회 · 추가
import { route, readJson } from '@/lib/auth';
import {
  assertCategory, assertProduct, assertWritableMonth, getDevWork, listDevWorks, listUserId, monthSubmitted,
  parseDevWorkInput, periodFromBody, periodFromQuery, resolveOwner, type DevWorkInput,
} from './_shared';

export const GET = route({}, async ({ user, req, db }) => {
  const { year, month } = periodFromQuery(req);
  const userId = listUserId(user, req.nextUrl.searchParams.get('user'));
  return db(async (tx) => {
    const works = await listDevWorks(tx, { year, month, userId });
    // 직원: 본인 월이 제출되어 잠겼는가. 관리자: 선택한 담당자의 월이 제출 상태인가(수정은 가능).
    const submitted = userId ? await monthSubmitted(tx, userId, year, month) : false;
    return { year, month, works, submitted, locked: user.role !== 'admin' && submitted };
  });
});

export const POST = route({}, async ({ user, req, db }) => {
  const body = await readJson(req);
  const { year, month } = periodFromBody(body);
  const input = parseDevWorkInput(body, false) as DevWorkInput;
  return db(async (tx) => {
    const ownerId = await resolveOwner(tx, user, body.user_id);
    await assertWritableMonth(tx, user, ownerId, year, month);
    await assertProduct(tx, input.product_id);
    await assertCategory(tx, input.category_id);
    const row = { user_id: ownerId, year, month, ...input };
    const [created] = await tx`insert into dev_works ${tx(row)} returning id`;
    return { work: await getDevWork(tx, created.id) };
  });
});
