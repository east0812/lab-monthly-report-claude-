'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, Badge, Button, Card, cn, Field, Modal, PageHeader, ReportBadge, Textarea, useToast, YearMonthNav } from '../ui';
import { DataTable, type Column } from '../DataTable';
import { Timeline } from '../Timeline';
import { ExportMenu } from './ExportMenu';
import { fmtDateTime, REPORT_STATUS, WORK_STATUS, WORK_STATUS_KEYS, type ReportStatus, type WorkStatus } from '@/lib/constants';
import type { TimelineRecord, TimelineRow } from '@/lib/data';

type Staff = {
  id: string; name: string; role: string; is_active: boolean; report_id: string | null; status: ReportStatus | null;
  submitted_at: string | null; updated_at: string | null; reject_reason: string | null; dev_count: number; transfer_count: number; item_count: number;
};
type CellEdit = { kind: 'dev' | 'transfer'; row: TimelineRow; records: TimelineRecord[]; pick: string; status: WorkStatus };

export function AdminReports({ year, month, staff, dev, transfer }: { year: number; month: number; staff: Staff[]; dev: TimelineRow[]; transfer: TimelineRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [reject, setReject] = useState<Staff | null>(null);
  const [reason, setReason] = useState('');
  const [cell, setCell] = useState<CellEdit | null>(null);

  const act = async (s: Staff, action: string, msg: string, extra?: Record<string, unknown>) => {
    setBusy(true);
    try { await api('POST', `/api/reports/${s.report_id}/transition`, { action, ...extra }); toast(`${s.name}: ${msg}`); router.refresh(); return true; }
    catch (e) { toast((e as Error).message, 'err'); return false; }
    finally { setBusy(false); }
  };
  const count = (st: ReportStatus | null) => staff.filter((s) => s.is_active && s.status === st).length;
  const activeCount = staff.filter((s) => s.is_active).length;
  const submittedCount = staff.filter((s) => s.is_active && s.status && ['submitted', 'reviewed', 'finalized'].includes(s.status)).length;

  const columns: Column<Staff>[] = [
    { key: 'name', label: '직원', width: 130, render: (s) => <span className="font-medium">{s.name}{s.role === 'admin' && <span className="ml-1 text-xs text-slate-500">(관리자)</span>}{!s.is_active && <span className="ml-1 text-xs text-rose-600">(비활성)</span>}</span> },
    { key: 'status', label: '제출 상태', width: 120, filter: true, value: (s) => (s.status ? REPORT_STATUS[s.status].label : '미작성'), render: (s) => <ReportBadge status={s.status} /> },
    { key: 'submitted_at', label: '제출일시', width: 140, value: (s) => fmtDateTime(s.submitted_at) },
    { key: 'item_count', label: '보고 항목', width: 86, align: 'right' },
    { key: 'dev_count', label: '개발현황', width: 86, align: 'right' },
    { key: 'transfer_count', label: '생산이관', width: 86, align: 'right' },
    { key: 'updated_at', label: '최근 수정', width: 140, value: (s) => fmtDateTime(s.updated_at) },
    { key: 'actions', label: '검토', width: 300, sortable: false, value: () => '', render: (s) => !s.report_id ? <span className="text-xs text-slate-400">보고서 없음</span> : (
      <span className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Link href={`/reports/${s.report_id}`}><Button size="sm">열기</Button></Link>
        {s.status === 'submitted' && <Button size="sm" variant="primary" disabled={busy} onClick={() => act(s, 'review', '관리자 확인 처리했습니다.')}>확인</Button>}
        {s.status === 'reviewed' && <Button size="sm" variant="primary" disabled={busy} onClick={() => act(s, 'finalize', '최종확정했습니다.')}>최종확정</Button>}
        {s.status && ['submitted', 'reviewed', 'finalized'].includes(s.status) && <Button size="sm" variant="danger" disabled={busy} onClick={() => { setReason(''); setReject(s); }}>반려</Button>}
      </span>) },
  ];

  const openCell = (kind: 'dev' | 'transfer') => (row: TimelineRow, _y: number, _m: number, records: TimelineRecord[]) =>
    setCell({ kind, row, records, pick: records[0].id, status: records[0].status });
  const saveCell = async () => {
    if (!cell) return;
    const rec = cell.records.find((r) => r.id === cell.pick)!;
    setBusy(true);
    try {
      await api('POST', '/api/admin/month-status', { kind: cell.kind, id: rec.id, status: cell.status, version: rec.version });
      toast('상태를 변경했습니다.'); setCell(null); router.refresh();
    } catch (e) { toast((e as Error).message, 'err'); }
    setBusy(false);
  };
  const isSel = (y: number, m: number) => y === year && m === month;
  const hint = <p className="mb-2 text-xs text-slate-600">파란색으로 표시된 <b>{year}년 {month}월</b> 열의 상태 칸을 누르면 그 달의 상태만 바로 바꿀 수 있습니다. 다른 월·담당자·상세 내용은 그대로 유지됩니다.</p>;

  return (
    <div className="space-y-4">
      <PageHeader title="월차보고 관리" desc="직원별 제출 상태를 확인하고 보고서를 검토·취합합니다."
        actions={<><YearMonthNav year={year} month={month} /><ExportMenu base={`/api/export/compile?year=${year}&month=${month}`} label="전체 취합 출력" /></>} />

      <div className="flex flex-wrap gap-2 text-sm">
        <Badge cls="bg-white text-slate-700 ring-slate-300">대상 {activeCount}명</Badge>
        <Badge cls="bg-blue-50 text-blue-800 ring-blue-200">제출 {submittedCount}명</Badge>
        {(['submitted', 'reviewed', 'finalized', 'rejected', 'draft'] as ReportStatus[]).map((s) => <Badge key={s} cls={REPORT_STATUS[s].cls}>{REPORT_STATUS[s].label} {count(s)}</Badge>)}
        <Badge cls="bg-white text-slate-500 ring-slate-300">미작성 {count(null)}</Badge>
      </div>

      <Card title={`${year}년 ${month}월 직원별 제출 현황`}>
        <DataTable id="admin-reports" rows={staff} columns={columns} rowKey={(s) => s.id} pageSize={20} searchPlaceholder="직원 검색"
          onRowClick={(s) => s.report_id && router.push(`/reports/${s.report_id}`)} />
        <p className="mt-2 text-xs text-slate-500">전체 취합 출력에는 제출완료·관리자 확인·최종확정 상태의 보고서와 저장된 개발현황·생산이관·매출이 포함됩니다.</p>
      </Card>

      <Card title="개발현황 · 모델별 24개월 타임라인">
        {hint}
        <Timeline tableId="admin-dev-timeline" year={year} rows={dev} highlight={{ year, month }} onCellClick={openCell('dev')} clickable={isSel} empty="개발현황 기록이 없습니다." />
      </Card>
      <Card title="생산이관 · 모델별 24개월 타임라인">
        {hint}
        <Timeline tableId="admin-transfer-timeline" year={year} rows={transfer} highlight={{ year, month }} onCellClick={openCell('transfer')} clickable={isSel} empty="생산이관 기록이 없습니다." />
      </Card>

      <Modal open={!!reject} onClose={() => setReject(null)} title={`${reject?.name ?? ''} 보고서 반려`}
        footer={<><Button onClick={() => setReject(null)}>취소</Button><Button variant="danger" disabled={busy || !reason.trim()} onClick={async () => { if (reject && await act(reject, 'reject', '반려했습니다.', { reason })) setReject(null); }}>반려</Button></>}>
        <Field label="반려 사유" required hint="작성자에게 알림으로 전달되고 이력에 남습니다."><Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      </Modal>

      {cell && (
        <Modal open onClose={() => setCell(null)} title={`${year}년 ${month}월 ${cell.kind === 'dev' ? '개발현황' : '생산이관'} 상태 수정`}
          footer={<><Button onClick={() => setCell(null)}>취소</Button><Button variant="primary" disabled={busy || cell.status === cell.records.find((r) => r.id === cell.pick)?.status} onClick={saveCell}>상태 저장</Button></>}>
          <div className="space-y-4 text-sm">
            <div className="rounded-md bg-slate-50 px-3 py-2"><b>{cell.row.product_name}</b> {cell.row.model} · 담당자 {cell.row.user_name}</div>
            {cell.records.length > 1 && (
              <fieldset>
                <legend className="mb-1.5 text-xs font-medium text-slate-600">이 칸에 기록이 {cell.records.length}건 있습니다. 수정할 기록을 선택하세요.</legend>
                <div className="space-y-1.5">
                  {cell.records.map((r) => (
                    <label key={r.id} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2', cell.pick === r.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200')}>
                      <input type="radio" name="rec" checked={cell.pick === r.id} onChange={() => setCell({ ...cell, pick: r.id, status: r.status })} />
                      <span className="min-w-0 flex-1 truncate">{r.title || '(제목 없음)'}</span>
                      <Badge cls={WORK_STATUS[r.status].cls}>{WORK_STATUS[r.status].mark} {WORK_STATUS[r.status].label}</Badge>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {cell.records.length === 1 && cell.records[0].title && <div className="text-slate-700">기록: {cell.records[0].title}</div>}
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-slate-600">변경할 상태</legend>
              <div className="flex flex-wrap gap-2">
                {WORK_STATUS_KEYS.map((s) => (
                  <button key={s} type="button" aria-pressed={cell.status === s} onClick={() => setCell({ ...cell, status: s })}
                    className={cn('rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset', cell.status === s ? 'ring-2 ring-blue-600 ' + WORK_STATUS[s].cls : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50')}>
                    {WORK_STATUS[s].mark} {WORK_STATUS[s].label}
                  </button>
                ))}
              </div>
              {cell.kind === 'dev' && cell.status === 'done' && <p className="mt-2 text-xs text-slate-500">완료로 바꾸면 진행률이 100%로 처리됩니다.</p>}
            </fieldset>
          </div>
        </Modal>
      )}
    </div>
  );
}
