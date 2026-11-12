// 전월 업무 이월 후보: 선택한 보고 월의 전월에 있는 예정·진행중·보류 업무
import { route } from '@/lib/auth';
import { prevYm } from '@/lib/constants';
import { listCarryCandidates, listUserId, monthSubmitted, periodFromQuery } from '../_shared';

export const GET = route({}, async ({ user, req, db }) => {
  const { year, month } = periodFromQuery(req);
  const userId = listUserId(user, req.nextUrl.searchParams.get('user'));
  const prev = prevYm(year, month);
  return db(async (tx) => {
    const candidates = await listCarryCandidates(tx, { prevYear: prev.year, prevMonth: prev.month, userId });
    const locked = user.role !== 'admin' && (await monthSubmitted(tx, user.id, year, month));
    return { year, month, prev, candidates, locked };
  });
});
