// 생산이관: 모델별 타임라인 + 월별 이관내역. 조회는 모두 로그인 사용자 권한(RLS)으로 실행한다.
import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { kstNow, parseIntParam } from '@/lib/constants';
import { listProducts, listUserNames, loadTimeline } from '@/lib/data';
import { listTransfers, monthSubmitted } from '@/app/api/dev-works/_shared';
import { TransfersView } from '@/components/dev/TransfersView';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function TransfersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireUser();
  const now = kstNow();
  const year = parseIntParam(sp.year, now.year, 2001, 2100);
  const month = parseIntParam(sp.month, now.month, 1, 12);
  const tab = one(sp.tab) === 'detail' ? 'detail' : 'timeline';
  const isAdmin = me.role === 'admin';

  const data = await withUser(me.id, async (tx) => {
    const users = isAdmin ? (await listUserNames(tx)).map((u) => ({ id: u.id, name: u.name })) : [];
    // 직원은 항상 본인 기록만. 관리자는 쿼리의 담당자(목록에 있을 때만), 없으면 전체('').
    const userId = isAdmin ? (users.some((u) => u.id === one(sp.user)) ? one(sp.user) : '') : me.id;
    if (tab === 'timeline') {
      return { users, userId, timeline: await loadTimeline(tx, 'transfer', year, { userId: userId || undefined }), detail: null };
    }
    const transfers = [...(await listTransfers(tx, { year, month, userId: userId || null }))];
    const products = (await listProducts(tx)).map((p) => ({ id: p.id, name: p.name, model: p.model, revision: p.revision }));
    const submitted = userId ? await monthSubmitted(tx, userId, year, month) : false;
    return { users, userId, timeline: null, detail: { transfers, products, submitted, locked: !isAdmin && submitted } };
  });

  return (
    <TransfersView viewer={{ id: me.id, name: me.name, isAdmin }} year={year} month={month} tab={tab}
      users={data.users} userId={data.userId} timeline={data.timeline} detail={data.detail} />
  );
}
