'use client';
// 월별 개발현황 상세 업무: 목록 + 편집 폼. 자동 저장(마지막 입력 1.5초 뒤)과 수동 저장 모두 version 을 보내는 PATCH 를 쓴다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Empty, Field, Input, Modal, Select, Textarea, WorkBadge, cn, useToast } from '@/components/ui';
import { WORK_STATUS, prevYm, type WorkStatus } from '@/lib/constants';
import type { CarryCandidate, DevWork } from '@/app/api/dev-works/_shared';
import { ApiError, LOCK_NOTICE, Notice, StatusOptions, callApi, errMsg, productText, type CategoryOpt, type ProductOpt, type UserOpt, type Viewer } from './shared';

const AUTOSAVE_MS = 1500;

type Editable = Pick<DevWork, 'product_id' | 'revision' | 'category_id' | 'title' | 'status' | 'progress' | 'work_done' | 'test_result' | 'issues' | 'actions' | 'next_plan' | 'user_id'>;
type Patch = Partial<Editable>;
type SaveState =
  | { kind: 'idle' } | { kind: 'dirty' } | { kind: 'saving' } | { kind: 'saved'; at: string }
  | { kind: 'error'; msg: string } | { kind: 'conflict'; msg: string };
/** 기록별 저장 대기열. version 은 서버가 마지막으로 돌려준 값이며 다음 PATCH 에 그대로 쓴다. */
type Entry = { version: number; pending: Patch; timer: ReturnType<typeof setTimeout> | null; running: Promise<void> | null; conflict: boolean };

type Props = {
  viewer: Viewer; year: number; month: number;
  /** 목록 범위. 관리자가 '전체'를 고르면 빈 문자열 */
  userId: string;
  users: UserOpt[]; products: ProductOpt[]; categories: CategoryOpt[];
  initialWorks: DevWork[]; locked: boolean; submitted: boolean; initialWorkId?: string;
};

const hhmm = () => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
const clampProgress = (v: string) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0; };
const TEXT_FIELDS: { key: 'work_done' | 'test_result' | 'issues' | 'actions' | 'next_plan'; label: string; hint?: string; wide?: boolean }[] = [
  { key: 'work_done', label: '수행내용' }, { key: 'test_result', label: '시험결과' },
  { key: 'issues', label: '문제점' }, { key: 'actions', label: '조치' },
  { key: 'next_plan', label: '차월계획', wide: true },
];

function CarriedBadge({ w }: { w: DevWork }) {
  if (!w.carried_from_id) return null;
  const from = w.carried_year && w.carried_month ? `${w.carried_year}년 ${w.carried_month}월 업무에서 이월` : '전월 업무에서 이월';
  return (
    <Badge cls="bg-violet-100 text-violet-800 ring-violet-300" title={from}>
      ↪ 전월 이월{w.carried_progress !== null && ` · 전월 ${w.carried_progress}%`}
    </Badge>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <span className="block h-full rounded-full bg-blue-600" style={{ width: `${value}%` }} />
    </span>
  );
}

export function DevWorksEditor({ viewer, year, month, userId, users, products, categories, initialWorks, locked: locked0, submitted: submitted0, initialWorkId }: Props) {
  const toast = useToast();
  const [works, setWorksState] = useState<DevWork[]>(initialWorks);
  const worksRef = useRef(works);
  const setWorks = useCallback((fn: (ws: DevWork[]) => DevWork[]) => { worksRef.current = fn(worksRef.current); setWorksState(worksRef.current); }, []);
  const [selectedId, setSelectedId] = useState<string | null>(() => (initialWorks.find((w) => w.id === initialWorkId) ?? initialWorks[0])?.id ?? null);
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const [locked, setLocked] = useState(locked0);
  const [submitted, setSubmitted] = useState(submitted0);
  const [addOpen, setAddOpen] = useState(false);
  const [carryOpen, setCarryOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const entries = useRef(new Map<string, Entry>());

  const readOnly = locked && !viewer.isAdmin;
  const selected = works.find((w) => w.id === selectedId) ?? null;
  const listUrl = `/api/dev-works?year=${year}&month=${month}${viewer.isAdmin && userId ? `&user=${userId}` : ''}`;

  const setState = useCallback((id: string, s: SaveState) => setStates((m) => ({ ...m, [id]: s })), []);
  const entryOf = useCallback((id: string): Entry => {
    let e = entries.current.get(id);
    if (!e) {
      e = { version: worksRef.current.find((w) => w.id === id)?.version ?? 1, pending: {}, timer: null, running: null, conflict: false };
      entries.current.set(id, e);
    }
    return e;
  }, []);

  /** 대기 중인 변경을 순서대로 저장한다. 한 기록에 동시에 한 요청만 보내 버전이 어긋나지 않게 한다. */
  const run = useCallback((id: string): Promise<void> => {
    const e = entryOf(id);
    if (e.running) return e.running; // 진행 중인 루프가 이후 변경까지 이어서 저장한다
    e.running = (async () => {
      try {
        while (!e.conflict && Object.keys(e.pending).length > 0) {
          const body = e.pending;
          e.pending = {};
          setState(id, { kind: 'saving' });
          try {
            const res = await callApi<{ work: DevWork }>('PATCH', `/api/dev-works/${id}`, { ...body, version: e.version });
            e.version = res.work.version;
            const later = e.pending; // 요청 중에 더 입력한 항목은 화면 값을 유지한다
            setWorks((ws) => ws.map((w) => (w.id !== id ? w : {
              ...w,
              version: res.work.version,
              updated_at: res.work.updated_at,
              progress: 'progress' in later || 'status' in later ? w.progress : res.work.progress, // 완료 → 100 (DB 강제)
              user_name: 'user_id' in later ? w.user_name : res.work.user_name,
            })));
            if (Object.keys(e.pending).length === 0) setState(id, { kind: 'saved', at: hhmm() });
          } catch (err) {
            e.pending = { ...body, ...e.pending }; // 저장하지 못한 변경은 버리지 않는다
            const status = err instanceof ApiError ? err.status : 0;
            if (status === 409 || status === 404) {
              // 충돌: 이 기록의 자동 저장을 멈추고, 사용자가 새로 고칠 때까지 덮어쓰지 않는다.
              e.conflict = true;
              if (e.timer) { clearTimeout(e.timer); e.timer = null; }
              setState(id, { kind: 'conflict', msg: errMsg(err) });
            } else {
              setState(id, { kind: 'error', msg: errMsg(err) });
            }
            return;
          }
        }
      } finally {
        e.running = null;
      }
    })();
    return e.running;
  }, [entryOf, setState, setWorks]);

  const flush = useCallback((id: string): Promise<void> => {
    const e = entries.current.get(id);
    if (!e) return Promise.resolve();
    if (e.timer) { clearTimeout(e.timer); e.timer = null; }
    if (e.conflict || (Object.keys(e.pending).length === 0 && !e.running)) return Promise.resolve();
    return run(id);
  }, [run]);
  const flushAll = useCallback(() => Promise.all([...entries.current.keys()].map((id) => flush(id))), [flush]);

  const change = (id: string, patch: Patch) => {
    if (readOnly) return;
    const e = entryOf(id);
    setWorks((ws) => ws.map((w) => {
      if (w.id !== id) return w;
      const next = { ...w, ...patch };
      if (patch.product_id !== undefined) {
        const p = products.find((x) => x.id === patch.product_id);
        if (p) { next.product_name = p.name; next.product_model = p.model; }
      }
      if (patch.category_id !== undefined) next.category_name = categories.find((c) => c.id === patch.category_id)?.name ?? '';
      if (patch.user_id !== undefined) next.user_name = users.find((u) => u.id === patch.user_id)?.name ?? next.user_name;
      return next;
    }));
    e.pending = { ...e.pending, ...patch };
    if (e.conflict) return; // 충돌 상태에서는 저장하지 않는다
    setState(id, { kind: 'dirty' });
    if (e.timer) clearTimeout(e.timer);
    e.timer = setTimeout(() => { e.timer = null; void run(id); }, AUTOSAVE_MS);
  };

  const saveNow = async (id: string) => {
    const e = entryOf(id);
    if (e.conflict) return;
    if (Object.keys(e.pending).length === 0 && !e.running) { toast('변경된 내용이 없습니다. 이미 저장된 상태입니다.'); return; }
    await flush(id);
    if (!e.conflict && Object.keys(e.pending).length === 0) toast('저장되었습니다.');
  };

  const select = (id: string) => {
    if (selectedId && selectedId !== id) void flush(selectedId); // 다른 업무로 옮기기 전에 바로 저장
    setSelectedId(id);
  };

  /** hard: 서버 내용으로 전부 바꾼다(충돌 해소). soft: 새로 생긴 기록만 덧붙인다(이월 뒤). */
  const reload = async (hard: boolean) => {
    setRefreshing(true);
    try {
      await flushAll();
      const r = await callApi<{ works: DevWork[]; locked: boolean; submitted: boolean }>('GET', listUrl);
      setLocked(r.locked); setSubmitted(r.submitted);
      if (hard) {
        for (const e of entries.current.values()) if (e.timer) clearTimeout(e.timer);
        entries.current.clear();
        setStates({});
        setWorks(() => r.works);
        setSelectedId((cur) => (r.works.some((w) => w.id === cur) ? cur : r.works[0]?.id ?? null));
      } else {
        const known = new Set(worksRef.current.map((w) => w.id));
        const added = r.works.filter((w) => !known.has(w.id));
        setWorks((ws) => [...ws, ...added]);
        setSelectedId((cur) => cur ?? added[0]?.id ?? null);
      }
    } catch (err) {
      toast(errMsg(err), 'err');
    } finally {
      setRefreshing(false);
    }
  };

  const remove = async (w: DevWork) => {
    if (!window.confirm(`'${w.title || productText({ name: w.product_name, model: w.product_model })}' 업무를 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
    const e = entryOf(w.id);
    if (e.timer) { clearTimeout(e.timer); e.timer = null; }
    e.pending = {};
    if (e.running) await e.running;
    try {
      await callApi('DELETE', `/api/dev-works/${w.id}?version=${e.version}`);
      entries.current.delete(w.id);
      setWorks((ws) => ws.filter((x) => x.id !== w.id));
      setStates((m) => { const n = { ...m }; delete n[w.id]; return n; });
      setSelectedId(worksRef.current[0]?.id ?? null);
      toast('삭제되었습니다.');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) { e.conflict = true; setState(w.id, { kind: 'conflict', msg: errMsg(err) }); }
      toast(errMsg(err), 'err');
    }
  };

  // 화면을 떠날 때(월 이동·탭 전환) 남은 변경을 바로 저장하고, 창을 닫을 때는 경고한다.
  // (flushAll 은 ref 와 고정된 setter 만 쓰므로 렌더마다 바뀌지 않는다 → 이 effect 는 마운트/언마운트 때만 실행)
  useEffect(() => {
    const map = entries.current;
    const beforeUnload = (ev: BeforeUnloadEvent) => {
      for (const e of map.values()) {
        if (Object.keys(e.pending).length > 0 || e.running) { ev.preventDefault(); ev.returnValue = ''; return; }
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      void flushAll();
    };
  }, [flushAll]);

  const st: SaveState = (selected && states[selected.id]) || { kind: 'idle' };
  const done = selected?.status === 'done';
  const productOptions = selected && !products.some((p) => p.id === selected.product_id)
    ? [{ id: selected.product_id, name: `${selected.product_name} (삭제된 제품)`, model: selected.product_model, revision: '' }, ...products] : products;
  const categoryOptions = selected?.category_id && !categories.some((c) => c.id === selected.category_id)
    ? [{ id: selected.category_id, name: `${selected.category_name} (사용 안 함)` }, ...categories] : categories;
  const userOptions = selected && !users.some((u) => u.id === selected.user_id) ? [{ id: selected.user_id, name: selected.user_name || '(비활성 직원)' }, ...users] : users;

  return (
    <div>
      {readOnly && <Notice kind="warn">🔒 {LOCK_NOTICE}</Notice>}
      {viewer.isAdmin && submitted && <Notice>이 담당자의 {year}년 {month}월 월차보고는 제출된 상태입니다. 관리자 권한으로는 수정할 수 있습니다.</Notice>}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card pad={false} title={`${year}년 ${month}월 업무 ${works.length}건`} actions={!readOnly && (
          <>
            <Button size="sm" onClick={() => setCarryOpen(true)}>전월 업무 이월</Button>
            <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>+ 업무 추가</Button>
          </>
        )}>
          {works.length === 0 ? (
            <div className="p-4"><Empty>{readOnly ? '이 달에 등록된 업무가 없습니다.' : '등록된 업무가 없습니다. "업무 추가" 또는 "전월 업무 이월"로 시작해 주세요.'}</Empty></div>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
              {works.map((w) => {
                const s = states[w.id]?.kind;
                return (
                  <li key={w.id}>
                    <button type="button" onClick={() => select(w.id)} aria-current={w.id === selectedId}
                      className={cn('block w-full px-3.5 py-2.5 text-left hover:bg-blue-50/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600', w.id === selectedId && 'bg-blue-50 shadow-[inset_3px_0_0_0_#2563eb]')}>
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-900">{w.product_name}{w.product_model && <span className="ml-1 font-normal text-slate-500">{w.product_model}</span>}</span>
                          <span className="block truncate text-xs text-slate-600">{w.title || '(업무명 없음)'}</span>
                        </span>
                        <WorkBadge status={w.status} />
                      </span>
                      <span className="mt-1.5 flex items-center gap-2">
                        <ProgressBar value={w.progress} />
                        <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-600">{w.progress}%</span>
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <CarriedBadge w={w} />
                        {viewer.isAdmin && <span>{w.user_name}</span>}
                        {(s === 'dirty' || s === 'saving') && <span className="text-blue-700">● 저장 대기</span>}
                        {s === 'error' && <span className="text-rose-700">● 저장 실패</span>}
                        {s === 'conflict' && <span className="text-rose-700">● 충돌</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {!selected ? (
          <Card><Empty>왼쪽 목록에서 업무를 선택하면 상세 내용을 볼 수 있습니다.</Empty></Card>
        ) : (
          <Card
            title={<span className="flex flex-wrap items-center gap-2">상세 업무<WorkBadge status={selected.status} /><CarriedBadge w={selected} /></span>}
            actions={!readOnly && (
              <>
                <span aria-live="polite" className={cn('text-xs', st.kind === 'error' || st.kind === 'conflict' ? 'text-rose-700' : st.kind === 'saved' ? 'text-emerald-700' : 'text-slate-500')}>
                  {st.kind === 'dirty' && '변경됨 · 잠시 후 자동 저장'}
                  {st.kind === 'saving' && '저장 중…'}
                  {st.kind === 'saved' && `저장됨 ${st.at}`}
                  {st.kind === 'error' && '저장 실패'}
                  {st.kind === 'conflict' && '저장 중지됨'}
                </span>
                <Button size="sm" variant="primary" disabled={st.kind === 'saving' || st.kind === 'conflict'} onClick={() => saveNow(selected.id)}>저장</Button>
                <Button size="sm" variant="danger" onClick={() => remove(selected)}>삭제</Button>
              </>
            )}>
            {st.kind === 'conflict' && (
              <Notice kind="error" action={<Button size="sm" disabled={refreshing} onClick={() => reload(true)}>새로 고침</Button>}>
                {st.msg} 자동 저장을 멈췄습니다. 새로 고치면 이 화면에서 저장되지 않은 변경은 사라집니다.
              </Notice>
            )}
            {st.kind === 'error' && (
              <Notice kind="error" action={<Button size="sm" onClick={() => saveNow(selected.id)}>다시 저장</Button>}>저장 실패: {st.msg}</Notice>
            )}

            <fieldset disabled={readOnly} className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="제품" required className="xl:col-span-2">
                <Select value={selected.product_id} onChange={(e) => {
                  const p = products.find((x) => x.id === e.target.value);
                  change(selected.id, { product_id: e.target.value, ...(selected.revision.trim() === '' && p?.revision ? { revision: p.revision } : {}) });
                }}>
                  {productOptions.map((p) => <option key={p.id} value={p.id}>{productText(p)}</option>)}
                </Select>
              </Field>
              <Field label="Revision">
                <Input value={selected.revision} maxLength={100} onChange={(e) => change(selected.id, { revision: e.target.value })} />
              </Field>
              <Field label="분류">
                <Select value={selected.category_id ?? ''} onChange={(e) => change(selected.id, { category_id: e.target.value || null })}>
                  <option value="">분류 없음</option>
                  {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="담당자" hint={viewer.isAdmin ? undefined : '담당자는 본인으로 고정됩니다.'}>
                {viewer.isAdmin ? (
                  <Select value={selected.user_id} onChange={(e) => change(selected.id, { user_id: e.target.value })}>
                    {userOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                ) : <Input value={selected.user_name || viewer.name} readOnly disabled />}
              </Field>
              <Field label="상태">
                <Select value={selected.status} onChange={(e) => {
                  const v = e.target.value as WorkStatus;
                  change(selected.id, v === 'done' ? { status: v, progress: 100 } : { status: v });
                }}>
                  <StatusOptions />
                </Select>
              </Field>
              <Field label="진행률 (%)" hint={done ? '완료 상태의 진행률은 100%로 고정됩니다.' : '0~100'}>
                <Input type="number" inputMode="numeric" min={0} max={100} step={1} disabled={done} value={done ? 100 : selected.progress}
                  onChange={(e) => change(selected.id, { progress: clampProgress(e.target.value) })} />
              </Field>
              <div className="flex items-end pb-2.5"><ProgressBar value={done ? 100 : selected.progress} /></div>
              <Field label="업무명" className="sm:col-span-2 xl:col-span-4">
                <Input value={selected.title} maxLength={200} placeholder="예: OO 모델 2차 시제품 개발" onChange={(e) => change(selected.id, { title: e.target.value })} />
              </Field>
              {TEXT_FIELDS.map((f) => (
                <Field key={f.key} label={f.label} className={f.wide ? 'sm:col-span-2 xl:col-span-4' : 'xl:col-span-2'}>
                  <Textarea rows={4} maxLength={5000} value={selected[f.key]} onChange={(e) => change(selected.id, { [f.key]: e.target.value } as Patch)} />
                </Field>
              ))}
            </fieldset>
            {!readOnly && <p className="mt-3 text-xs text-slate-500">입력을 멈추면 약 1.5초 뒤 자동으로 저장됩니다. &quot;저장&quot; 버튼으로 바로 저장할 수도 있습니다.</p>}
          </Card>
        )}
      </div>

      {addOpen && (
        <AddWorkModal viewer={viewer} year={year} month={month} userId={userId} users={users} products={products} categories={categories}
          onClose={() => setAddOpen(false)}
          onCreated={(w) => { setWorks((ws) => [...ws, w]); select(w.id); setAddOpen(false); toast('업무를 추가했습니다.'); }} />
      )}
      {carryOpen && (
        <CarryOverModal viewer={viewer} year={year} month={month} userId={userId}
          onClose={() => setCarryOpen(false)}
          onDone={(created, skipped) => { setCarryOpen(false); toast(`${created}건 이월, ${skipped}건 건너뜀`); if (created > 0) void reload(false); }} />
      )}
    </div>
  );
}

function AddWorkModal({ viewer, year, month, userId, users, products, categories, onClose, onCreated }: {
  viewer: Viewer; year: number; month: number; userId: string; users: UserOpt[]; products: ProductOpt[]; categories: CategoryOpt[];
  onClose: () => void; onCreated: (w: DevWork) => void;
}) {
  const [f, setF] = useState({
    product_id: '', title: '', category_id: '', status: 'in_progress' as WorkStatus,
    user_id: userId || (users.some((u) => u.id === viewer.id) ? viewer.id : users[0]?.id ?? viewer.id),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!f.product_id) { setError('제품을 선택해 주세요.'); return; }
    setBusy(true); setError('');
    try {
      const p = products.find((x) => x.id === f.product_id);
      const r = await callApi<{ work: DevWork }>('POST', '/api/dev-works', {
        year, month, product_id: f.product_id, revision: p?.revision ?? '', category_id: f.category_id || null,
        title: f.title, status: f.status, progress: f.status === 'done' ? 100 : 0, user_id: viewer.isAdmin ? f.user_id : undefined,
      });
      onCreated(r.work);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`업무 추가 · ${year}년 ${month}월`} footer={
      <>
        <Button onClick={onClose}>취소</Button>
        <Button variant="primary" disabled={busy} onClick={submit}>{busy ? '추가 중…' : '추가'}</Button>
      </>
    }>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="제품" required className="sm:col-span-2" hint="제품을 고르면 그 제품의 Revision 이 자동으로 들어갑니다.">
          <Select value={f.product_id} autoFocus onChange={(e) => setF({ ...f, product_id: e.target.value })}>
            <option value="">제품을 선택하세요</option>
            {products.map((p) => <option key={p.id} value={p.id}>{productText(p)}</option>)}
          </Select>
        </Field>
        <Field label="업무명" className="sm:col-span-2">
          <Input value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="분류">
          <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            <option value="">분류 없음</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="상태">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as WorkStatus })}><StatusOptions /></Select>
        </Field>
        <Field label="담당자" className="sm:col-span-2">
          {viewer.isAdmin ? (
            <Select value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          ) : <Input value={viewer.name} readOnly disabled />}
        </Field>
      </div>
    </Modal>
  );
}

function CarryOverModal({ viewer, year, month, userId, onClose, onDone }: {
  viewer: Viewer; year: number; month: number; userId: string; onClose: () => void; onDone: (created: number, skipped: number) => void;
}) {
  const prev = prevYm(year, month);
  const [list, setList] = useState<CarryCandidate[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    callApi<{ candidates: CarryCandidate[] }>('GET', `/api/dev-works/carry-candidates?year=${year}&month=${month}${viewer.isAdmin && userId ? `&user=${userId}` : ''}`)
      .then((r) => { if (!alive) return; setList(r.candidates); setChecked(new Set(r.candidates.filter((c) => !c.carried).map((c) => c.id))); })
      .catch((err) => { if (alive) { setList([]); setError(errMsg(err)); } });
    return () => { alive = false; };
  }, [year, month, userId, viewer.isAdmin]);

  const open = (list ?? []).filter((c) => !c.carried);
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const r = await callApi<{ created: number; skipped: number }>('POST', '/api/dev-works/carry-over', { year, month, ids: [...checked] });
      onDone(r.created, r.skipped);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <Modal open wide onClose={onClose} title={`전월 업무 이월 · ${prev.year}년 ${prev.month}월 → ${year}년 ${month}월`} footer={
      <>
        <Button onClick={onClose}>취소</Button>
        <Button variant="primary" disabled={busy || checked.size === 0} onClick={submit}>{busy ? '이월 중…' : `선택한 ${checked.size}건 이월`}</Button>
      </>
    }>
      {error && <Notice kind="error">{error}</Notice>}
      <p className="mb-3 text-sm text-slate-600">
        전월의 <b>예정·진행중·보류</b> 업무를 이번 달로 가져옵니다. 제품·Revision·분류·업무명·상태·진행률은 유지되고, 수행내용과 시험결과는 비어 있는 상태로 시작합니다. 같은 업무는 한 번만 이월됩니다.
      </p>
      {list === null ? <Empty>불러오는 중…</Empty> : list.length === 0 ? <Empty>{prev.year}년 {prev.month}월에 이월할 수 있는 업무가 없습니다.</Empty> : (
        <>
          <div className="mb-2 flex items-center gap-2 text-xs text-slate-600">
            <Button size="sm" disabled={open.length === 0} onClick={() => setChecked(new Set(open.map((c) => c.id)))}>전체 선택</Button>
            <Button size="sm" disabled={checked.size === 0} onClick={() => setChecked(new Set())}>선택 해제</Button>
            <span>이월 가능 {open.length}건 · 이미 이월됨 {list.length - open.length}건</span>
          </div>
          <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
            {list.map((c) => (
              <li key={c.id}>
                <label className={cn('flex items-center gap-3 px-3 py-2 text-sm', c.carried ? 'cursor-not-allowed bg-slate-50 text-slate-400' : 'cursor-pointer hover:bg-blue-50/60')}>
                  <input type="checkbox" disabled={c.carried} checked={!c.carried && checked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`${c.product_name} ${c.title} 이월 선택`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.product_name}{c.product_model && <span className="ml-1 font-normal text-slate-500">{c.product_model}</span>}{c.revision && <span className="ml-1 font-normal text-slate-500">· {c.revision}</span>}</span>
                    <span className="block truncate text-xs text-slate-500">{c.title || '(업무명 없음)'}{c.category_name && ` · ${c.category_name}`}{viewer.isAdmin && ` · ${c.user_name}`}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums">{WORK_STATUS[c.status].label} {c.progress}%</span>
                  {c.carried && <Badge cls="bg-slate-100 text-slate-600 ring-slate-300">이월됨</Badge>}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
