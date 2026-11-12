// 생산이관 월별 내역: 목록 조회 · 추가
import { route, readJson } from '@/lib/auth';
import {
  assertProduct, assertWritableMonth, getTransfer, listTransfers, listUserId, monthSubmitted,
  parseTransferInput, periodFromBody, periodFromQuery, resolveOwner, type TransferInput,
} from '../dev-works/_shared';

export const GET = route({}, async ({ user, req, db }) => {
  const { year, month } = periodFromQuery(req);
  const userId = listUserId(user, req.nextUrl.searchParams.get('user'));
  return db(async (tx) => {
    const transfers = await listTransfers(tx, { year, month, userId });
    const submitted = userId ? await monthSubmitted(tx, userId, year, month) : false;
    return { year, month, transfers, submitted, locked: user.role !== 'admin' && submitted };
  });
});

export const POST = route({}, async ({ user, req, db }) => {
  const body = await readJson(req);
  const { year, month } = periodFromBody(body);
  const input = parseTransferInput(body, false) as TransferInput;
  return db(async (tx) => {
    const ownerId = await resolveOwner(tx, user, body.user_id);
    await assertWritableMonth(tx, user, ownerId, year, month);
    await assertProduct(tx, input.product_id);
    const row = { user_id: ownerId, year, month, ...input };
    const [created] = await tx`insert into transfers ${tx(row)} returning id`;
    return { transfer: await getTransfer(tx, created.id) };
  });
});
