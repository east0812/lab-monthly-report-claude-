'use client';
// 개발현황 화면: 모델별 타임라인 탭 + 월별 개발현황(상세 업무) 탭
import { Card } from '@/components/ui';
import { Timeline } from '@/components/Timeline';
import type { TimelineRow } from '@/lib/data';
import type { DevWork } from '@/app/api/dev-works/_shared';
import { DevWorksEditor } from './DevWorksEditor';
import { MonthPageFrame, useQueryNav, type CategoryOpt, type ProductOpt, type TabKey, type UserOpt, type Viewer } from './shared';

type Props = {
  viewer: Viewer; year: number; month: number; tab: TabKey;
  users: UserOpt[]; userId: string;
  timeline: TimelineRow[] | null;
  detail: { works: DevWork[]; products: ProductOpt[]; categories: CategoryOpt[]; locked: boolean; submitted: boolean; workId?: string } | null;
};

export function DevStatusView({ viewer, year, month, tab, users, userId, timeline, detail }: Props) {
  const nav = useQueryNav();
  return (
    <MonthPageFrame title="개발현황" desc="모델별 개발 진행 상태와 월별 상세 업무를 관리합니다." year={year} month={month}
      viewer={viewer} users={users} userId={userId} tab={tab} detailLabel={viewer.isAdmin ? '월별 개발현황' : '내 월별 개발현황'}>
      {tab === 'timeline' && timeline && (
        <Card>
          <p className="mb-3 text-xs text-slate-500">
            {viewer.isAdmin ? '선택한 담당자의' : '내가 담당한'} 모델별 상태를 {year - 1}년~{year}년 24개월로 보여 줍니다. 기록이 있는 칸을 누르면 그 달의 상세 업무로 이동합니다.
          </p>
          <Timeline tableId="dev-status" year={year} rows={timeline} highlight={{ year, month }}
            empty="개발현황 기록이 없습니다. 상세 업무 탭에서 업무를 추가해 주세요."
            onCellClick={(row, y, m, recs) => nav({ year: y, month: m, tab: 'detail', work: recs[0]?.id ?? null, user: viewer.isAdmin ? row.user_id : null })} />
        </Card>
      )}
      {tab === 'detail' && detail && (
        <DevWorksEditor key={`${year}-${month}-${userId}`} viewer={viewer} year={year} month={month} userId={viewer.isAdmin ? userId : ''}
          users={users} products={detail.products} categories={detail.categories}
          initialWorks={detail.works} locked={detail.locked} submitted={detail.submitted} initialWorkId={detail.workId} />
      )}
    </MonthPageFrame>
  );
}
