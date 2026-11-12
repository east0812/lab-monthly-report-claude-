'use client';
// 내 업무 이력 표
import { useRouter } from 'next/navigation';
import { Card, PageHeader, ReportBadge, Select, WorkBadge } from '../ui';
import { DataTable, type Column } from '../DataTable';
import { WORK_STATUS, type ReportStatus, type WorkStatus } from '@/lib/constants';

export type HistoryRow = {
  key: string;
  year: number;
  month: number;
  kind: string;            // 구분: 개발현황 / 생산이관 / SM 도면 / … / 개발과제
  product: string;
  summary: string;
  revision: string;
  status: WorkStatus;      // 보고 항목의 상태(done/in_progress/on_hold)도 같은 키를 쓴다
  progress: number | null;
  reportStatus: ReportStatus | null;
  href: string;
};

export function MyHistoryTable({ rows, years, year }: { rows: HistoryRow[]; years: number[]; year: number }) {
  const router = useRouter();
  const yearList = year && !years.includes(year) ? [year, ...years] : years;

  const columns: Column<HistoryRow>[] = [
    { key: 'ym', label: '연월', width: 90, value: (r) => `${r.year}-${String(r.month).padStart(2, '0')}` },
    { key: 'kind', label: '구분', width: 110, filter: true },
    { key: 'product', label: '제품/모델', width: 200 },
    { key: 'summary', label: '제목·내용 요약', width: 380 },
    { key: 'revision', label: 'Revision', width: 90 },
    { key: 'status', label: '상태', width: 100, filter: true, value: (r) => WORK_STATUS[r.status]?.label ?? '', render: (r) => (WORK_STATUS[r.status] ? <WorkBadge status={r.status} /> : null) },
    { key: 'progress', label: '진행률', width: 80, align: 'right', value: (r) => r.progress, render: (r) => (r.progress === null ? <span className="text-slate-400">-</span> : `${r.progress}%`) },
    { key: 'reportStatus', label: '보고서 상태', width: 110, value: (r) => r.reportStatus ?? '', render: (r) => (r.reportStatus ? <ReportBadge status={r.reportStatus} /> : <span className="text-slate-400">-</span>), sortable: false },
  ];

  return (
    <div>
      <PageHeader title="내 업무 이력" desc="내가 기록한 개발현황·생산이관·월차보고 항목·개발과제를 한곳에서 봅니다. 행을 누르면 해당 화면으로 이동합니다." />
      <Card>
        <DataTable id="history-my" rows={rows} columns={columns} rowKey={(r) => r.key} onRowClick={(r) => router.push(r.href)}
          searchPlaceholder="제품·내용 검색" empty="기록된 업무가 없습니다." initialSort={{ key: 'ym', dir: 'desc' }}
          toolbar={
            <Select aria-label="연도" value={year ? String(year) : ''} className="!h-8 !w-auto text-xs"
              onChange={(e) => router.push(e.target.value ? `/history/my?year=${e.target.value}` : '/history/my')}>
              <option value="">연도: 전체</option>
              {yearList.map((y) => <option key={y} value={y}>{y}년</option>)}
            </Select>
          } />
      </Card>
    </div>
  );
}
