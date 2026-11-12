// 매출 화면 공용 표시 부품 (서버·클라이언트 컴포넌트 양쪽에서 사용)
import { Badge } from '@/components/ui';
import { fmtWon } from '@/lib/constants';
import type { SalesMonth } from '@/lib/sales-data';

/** 미등록은 "미등록" 글자로, 실제 0 은 "0원" 으로 */
export function Money({ v }: { v: number | null | undefined }) {
  return v === null || v === undefined ? <span className="text-amber-700">미등록</span> : <>{fmtWon(v)}</>;
}

/** 월 상태: 등록됨 / 미등록 / 0원 확정 */
export function MonthState({ m }: { m: Pick<SalesMonth, 'registered' | 'zeroConfirmed'> }) {
  if (m.zeroConfirmed) return <Badge cls="bg-slate-100 text-slate-700 ring-slate-400" title="매출이 없는 달로 확정됨">0원 확정</Badge>;
  if (m.registered) return <Badge cls="bg-blue-100 text-blue-800 ring-blue-300">등록됨</Badge>;
  return <Badge cls="bg-amber-50 text-amber-800 ring-amber-300" title="매출 자료가 아직 등록되지 않음">미등록</Badge>;
}

export const KIND_CLS: Record<string, string> = {
  sale: 'bg-blue-50 text-blue-800 ring-blue-200',
  return: 'bg-rose-50 text-rose-800 ring-rose-200',
  freight: 'bg-slate-100 text-slate-700 ring-slate-300',
  misc: 'bg-violet-50 text-violet-800 ring-violet-200',
};
