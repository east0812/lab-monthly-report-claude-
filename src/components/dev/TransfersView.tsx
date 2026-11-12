'use client';
// 생산이관 화면: 모델별 타임라인 탭 + 월별 이관내역 탭(표 · 추가/수정 모달 · 삭제)
import { useMemo, useState } from 'react';
import { Button, Card, Field, Input, Modal, Select, Textarea, WorkBadge, useToast } from '@/components/ui';
import { DataTable, type Column } from '@/components/DataTable';
import { Timeline } from '@/components/Timeline';
import { WORK_STATUS, type WorkStatus } from '@/lib/constants';
import type { TimelineRow } from '@/lib/data';
import type { Transfer } from '@/app/api/dev-works/_shared';
import { ApiError, LOCK_NOTICE, MonthPageFrame, Notice, StatusOptions, callApi, errMsg, productText, useQueryNav, type ProductOpt, type TabKey, type UserOpt, type Viewer } from './shared';

type Detail = { transfers: Transfer[]; products: ProductOpt[]; locked: boolean; submitted: boolean };
type Props = {
  viewer: Viewer; year: number; month: number; tab: TabKey;
  users: UserOpt[]; userId: string;
  timeline: TimelineRow[] | null;
  detail: Detail | null;
};

export function TransfersView({ viewer, year, month, tab, users, userId, timeline, detail }: Props) {
  const nav = useQueryNav();
  return (
    <MonthPageFrame title="생산이관" desc="모델별 생산이관 진행 상태와 월별 이관내역을 관리합니다." year={year} month={month}
      viewer={viewer} users={users} userId={userId} tab={tab} detailLabel="월별 이관내역">
      {tab === 'timeline' && timeline && (
        <Card>
          <p className="mb-3 text-xs text-slate-500">
            {viewer.isAdmin ? '선택한 담당자의' : '내가 담당한'} 모델별 이관상태를 {year - 1}년~{year}년 24개월로 보여 줍니다. 기록이 있는 칸을 누르면 그 달의 이관내역으로 이동합니다.
          </p>
          <Timeline tableId="transfers" year={year} rows={timeline} highlight={{ year, month }}
            empty="생산이관 기록이 없습니다. 월별 이관내역 탭에서 추가해 주세요."
            onCellClick={(row, y, m) => nav({ year: y, month: m, tab: 'detail', user: viewer.isAdmin ? row.user_id : null })} />
        </Card>
      )}
      {tab === 'detail' && detail && (
        <TransferTable key={`${year}-${month}-${userId}`} viewer={viewer} year={year} month={month} userId={viewer.isAdmin ? userId : ''} users={users} detail={detail} />
      )}
    </MonthPageFrame>
  );
}

type Form = {
  id: string | null; version: number;
  product_id: string; user_id: string; dev_status: WorkStatus; transfer_status: WorkStatus;
  planned_date: string; completed_date: string; content: string; plan: string;
};

function TransferTable({ viewer, year, month, userId, users, detail }: { viewer: Viewer; year: number; month: number; userId: string; users: UserOpt[]; detail: Detail }) {
  const toast = useToast();
  const [rows, setRows] = useState<Transfer[]>(detail.transfers);
  const [locked, setLocked] = useState(detail.locked);
  const [submitted, setSubmitted] = useState(detail.submitted);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ msg: string; conflict: boolean } | null>(null);
  const readOnly = locked && !viewer.isAdmin;
  const { products } = detail;

  const reload = async () => {
    const r = await callApi<{ transfers: Transfer[]; locked: boolean; submitted: boolean }>('GET', `/api/transfers?year=${year}&month=${month}${viewer.isAdmin && userId ? `&user=${userId}` : ''}`);
    setRows(r.transfers); setLocked(r.locked); setSubmitted(r.submitted);
  };

  const openNew = () => {
    setError(null);
    setForm({
      id: null, version: 0, product_id: '', dev_status: 'in_progress', transfer_status: 'planned', planned_date: '', completed_date: '', content: '', plan: '',
      user_id: userId || (users.some((u) => u.id === viewer.id) ? viewer.id : users[0]?.id ?? viewer.id),
    });
  };
  const openEdit = (t: Transfer) => {
    setError(null);
    setForm({
      id: t.id, version: t.version, product_id: t.product_id, user_id: t.user_id, dev_status: t.dev_status, transfer_status: t.transfer_status,
      planned_date: t.planned_date ?? '', completed_date: t.completed_date ?? '', content: t.content, plan: t.plan,
    });
  };

  const save = async () => {
    if (!form) return;
    if (!form.product_id) { setError({ msg: '제품을 선택해 주세요.', conflict: false }); return; }
    setBusy(true); setError(null);
    const body = {
      product_id: form.product_id, dev_status: form.dev_status, transfer_status: form.transfer_status,
      planned_date: form.planned_date || null, completed_date: form.completed_date || null, content: form.content, plan: form.plan,
      user_id: viewer.isAdmin ? form.user_id : undefined,
    };
    try {
      if (form.id) {
        // 화면이 본 version 을 함께 보내 오래된 화면의 덮어쓰기를 막는다.
        const r = await callApi<{ transfer: Transfer }>('PATCH', `/api/transfers/${form.id}`, { ...body, version: form.version });
        setRows((l) => l.map((x) => (x.id === r.transfer.id ? r.transfer : x)));
        toast('저장되었습니다.');
      } else {
        const r = await callApi<{ transfer: Transfer }>('POST', '/api/transfers', { ...body, year, month });
        setRows((l) => [...l, r.transfer]);
        toast('이관 기록을 추가했습니다.');
      }
      setForm(null);
    } catch (err) {
      setError({ msg: errMsg(err), conflict: err instanceof ApiError && (err.status === 409 || err.status === 404) });
    } finally {
      setBusy(false);
    }
  };

  const refreshAfterConflict = async () => {
    setBusy(true);
    try {
      await reload();
      setForm(null); setError(null);
      toast('최신 내용으로 새로 고쳤습니다. 내용을 확인한 뒤 다시 수정해 주세요.');
    } catch (err) {
      setError({ msg: errMsg(err), conflict: true });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: Transfer) => {
    if (!window.confirm(`'${productText({ name: t.product_name, model: t.product_model })}' 이관 기록을 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
    try {
      await callApi('DELETE', `/api/transfers/${t.id}?version=${t.version}`);
      setRows((l) => l.filter((x) => x.id !== t.id));
      toast('삭제되었습니다.');
    } catch (err) {
      toast(errMsg(err), 'err');
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) { try { await reload(); } catch {} }
    }
  };

  const columns = useMemo<Column<Transfer>[]>(() => {
    const cols: Column<Transfer>[] = [
      { key: 'product_name', label: '제품', width: 170 },
      { key: 'product_model', label: '모델', width: 130 },
      { key: 'user_name', label: '담당자', width: 90, filter: viewer.isAdmin },
      { key: 'dev_status', label: '개발상태', width: 100, value: (r) => WORK_STATUS[r.dev_status].label, render: (r) => <WorkBadge status={r.dev_status} />, filter: true },
      { key: 'transfer_status', label: '이관상태', width: 100, value: (r) => WORK_STATUS[r.transfer_status].label, render: (r) => <WorkBadge status={r.transfer_status} />, filter: true },
      { key: 'planned_date', label: '예정일', width: 104, render: (r) => <span className="whitespace-nowrap tabular-nums">{r.planned_date ?? ''}</span> },
      { key: 'completed_date', label: '완료일', width: 104, render: (r) => <span className="whitespace-nowrap tabular-nums">{r.completed_date ?? ''}</span> },
      { key: 'content', label: '내용', width: 260, wrap: true },
      { key: 'plan', label: '계획', width: 220, wrap: true },
    ];
    if (!readOnly) {
      cols.push({
        key: '_actions', label: '관리', width: 112, sortable: false, value: () => '',
        render: (r) => (
          <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" onClick={() => openEdit(r)} aria-label={`${r.product_name} 이관 기록 수정`}>수정</Button>
            <Button size="sm" variant="danger" onClick={() => remove(r)} aria-label={`${r.product_name} 이관 기록 삭제`}>삭제</Button>
          </span>
        ),
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.isAdmin, readOnly]);

  const productOptions = form && form.id && !products.some((p) => p.id === form.product_id)
    ? (() => { const t = rows.find((x) => x.id === form.id); return t ? [{ id: t.product_id, name: `${t.product_name} (삭제된 제품)`, model: t.product_model, revision: '' }, ...products] : products; })()
    : products;
  const userOptions = form && !users.some((u) => u.id === form.user_id)
    ? [{ id: form.user_id, name: rows.find((x) => x.id === form.id)?.user_name || '(비활성 직원)' }, ...users] : users;
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <div>
      {readOnly && <Notice kind="warn">🔒 {LOCK_NOTICE}</Notice>}
      {viewer.isAdmin && submitted && <Notice>이 담당자의 {year}년 {month}월 월차보고는 제출된 상태입니다. 관리자 권한으로는 수정할 수 있습니다.</Notice>}
      <Card title={`${year}년 ${month}월 이관내역`}>
        <DataTable<Transfer> id="transfers-month" rows={rows} columns={columns} rowKey={(r) => r.id}
          searchPlaceholder="제품·모델·내용 검색" empty="이 달에 등록된 이관 기록이 없습니다."
          onRowClick={readOnly ? undefined : openEdit}
          toolbar={!readOnly && <Button size="sm" variant="primary" onClick={openNew}>+ 이관 기록 추가</Button>} />
      </Card>

      {form && (
        <Modal open wide onClose={() => { if (!busy) setForm(null); }} title={`${form.id ? '이관 기록 수정' : '이관 기록 추가'} · ${year}년 ${month}월`} footer={
          <>
            <Button onClick={() => setForm(null)} disabled={busy}>취소</Button>
            <Button variant="primary" disabled={busy || !!error?.conflict} onClick={save}>{busy ? '저장 중…' : '저장'}</Button>
          </>
        }>
          {error && (
            <Notice kind="error" action={error.conflict ? <Button size="sm" disabled={busy} onClick={refreshAfterConflict}>새로 고침</Button> : undefined}>
              {error.msg}{error.conflict && ' 새로 고치면 이 창에서 입력한 내용은 사라집니다.'}
            </Notice>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="제품" required>
              <Select value={form.product_id} onChange={(e) => set({ product_id: e.target.value })}>
                {!form.id && <option value="">제품을 선택하세요</option>}
                {productOptions.map((p) => <option key={p.id} value={p.id}>{productText(p)}</option>)}
              </Select>
            </Field>
            <Field label="담당자" hint={viewer.isAdmin ? undefined : '담당자는 본인으로 고정됩니다.'}>
              {viewer.isAdmin ? (
                <Select value={form.user_id} onChange={(e) => set({ user_id: e.target.value })}>
                  {userOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              ) : <Input value={viewer.name} readOnly disabled />}
            </Field>
            <Field label="개발상태">
              <Select value={form.dev_status} onChange={(e) => set({ dev_status: e.target.value as WorkStatus })}><StatusOptions /></Select>
            </Field>
            <Field label="이관상태">
              <Select value={form.transfer_status} onChange={(e) => set({ transfer_status: e.target.value as WorkStatus })}><StatusOptions /></Select>
            </Field>
            <Field label="예정일">
              <Input type="date" value={form.planned_date} onChange={(e) => set({ planned_date: e.target.value })} />
            </Field>
            <Field label="완료일">
              <Input type="date" value={form.completed_date} onChange={(e) => set({ completed_date: e.target.value })} />
            </Field>
            <Field label="내용" className="sm:col-span-2">
              <Textarea rows={4} maxLength={5000} value={form.content} onChange={(e) => set({ content: e.target.value })} />
            </Field>
            <Field label="계획" className="sm:col-span-2">
              <Textarea rows={3} maxLength={5000} value={form.plan} onChange={(e) => set({ plan: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
