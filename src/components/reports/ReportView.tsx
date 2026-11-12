'use client';
// 월차보고 한 건: 조회 + (작성자·작성중/반려일 때) 편집, 상태 전이, 첨부, 이력
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, Button, Card, cn, Empty, Field, Input, ItemBadge, Modal, Multiline, ReportBadge, Select, Textarea, useToast, WorkBadge } from '../ui';
import { ExportMenu } from './ExportMenu';
import { ATTACH_EXT, fmtDateTime, fmtNum, ITEM_STATUS, ITEM_STATUS_KEYS, REPORT_FLOW, REPORT_STATUS, SECTIONS, type ItemField, type Role, type SectionKey } from '@/lib/constants';
import type { ReportFull, ReportItem, ReportProject } from '@/lib/reports';
import type { Category, Product } from '@/lib/data';

type Props = { data: ReportFull; me: { id: string; role: Role }; products: Product[]; categories: Category[] };
type Draft = Record<string, string>;

const pLabel = (name: string | null, model: string | null) => (name ? `${name}${model ? ` (${model})` : ''}` : '');

export function ReportView({ data, me, products, categories }: Props) {
  const { report, items, projects, attachments, history, devWorks, transfers } = data;
  const router = useRouter();
  const toast = useToast();
  const isOwner = report.user_id === me.id;
  const isAdmin = me.role === 'admin';
  const editable = isOwner && (report.status === 'draft' || report.status === 'rejected');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); router.refresh(); return true; }
    catch (e) { toast((e as Error).message, 'err'); return false; }
    finally { setBusy(false); }
  };

  // ── 요약 ──
  const [summary, setSummary] = useState(report.summary);
  const [version, setVersion] = useState(report.version);
  const dirty = summary !== report.summary;
  useEffect(() => { setVersion(report.version); }, [report.version]);
  const saveSummary = async () => {
    setBusy(true);
    try {
      const r = await api<{ version: number }>('PATCH', `/api/reports/${report.id}`, { summary, version });
      setVersion(r.version); toast('요약을 저장했습니다.'); router.refresh();
    } catch (e) { toast((e as Error).message, 'err'); }
    setBusy(false);
  };

  // ── 상태 전이 ──
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const transition = async (action: string, msg: string, confirmMsg?: string, extra?: Record<string, unknown>) => {
    if (dirty && action === 'submit') { toast('요약을 먼저 저장해 주세요.', 'err'); return; }
    if (confirmMsg && !confirm(confirmMsg)) return;
    return run(() => api('POST', `/api/reports/${report.id}/transition`, { action, ...extra }), msg);
  };

  // ── 항목 편집 ──
  const [itemModal, setItemModal] = useState<{ section: SectionKey; item: ReportItem | null } | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const openItem = (section: SectionKey, item: ReportItem | null) => {
    const d: Draft = { status: 'in_progress' };
    if (item) for (const f of SECTIONS.find((s) => s.key === section)!.fields) d[f.key] = String((item as unknown as Record<string, unknown>)[f.key] ?? '');
    setDraft(d); setItemModal({ section, item });
  };
  const saveItem = async () => {
    if (!itemModal) return;
    const { section, item } = itemModal;
    const ok = await run(() => item
      ? api('PATCH', `/api/reports/${report.id}/items`, { ...draft, id: item.id, version: item.version })
      : api('POST', `/api/reports/${report.id}/items`, { ...draft, section }), '저장했습니다.');
    if (ok) setItemModal(null);
  };
  const delItem = (it: ReportItem) => { if (confirm('이 항목을 삭제할까요?')) run(() => api('DELETE', `/api/reports/${report.id}/items?item=${it.id}`), '삭제했습니다.'); };

  // ── 개발과제 ──
  const [pjModal, setPjModal] = useState<{ mode: 'new' | 'existing' | 'project' | 'monthly'; row?: ReportProject } | null>(null);
  const [pj, setPj] = useState<Draft>({});
  const [pickList, setPickList] = useState<{ id: string; name: string; last_progress: number | null }[]>([]);
  const openPj = async (mode: 'new' | 'existing' | 'project' | 'monthly', row?: ReportProject) => {
    if (mode === 'existing') {
      try { const r = await api<{ projects: typeof pickList }>('GET', `/api/reports/${report.id}/projects`); setPickList(r.projects); setPj({ project_id: r.projects[0]?.id ?? '', progress: String(r.projects[0]?.last_progress ?? 0), status: 'in_progress' }); }
      catch (e) { toast((e as Error).message, 'err'); return; }
    } else if (row) {
      setPj({ name: row.name, goal: row.goal, product_id: row.product_id ?? '', category_id: row.category_id ?? '', start_date: row.start_date ?? '', end_date: row.end_date ?? '',
        progress: String(row.progress), status: row.status, result: row.result, issue: row.issue, next_plan: row.next_plan });
    } else setPj({ progress: '0', status: 'in_progress' });
    setPjModal({ mode, row });
  };
  const savePj = async () => {
    if (!pjModal) return;
    const { mode, row } = pjModal;
    const body = { ...pj, progress: Number(pj.progress || 0) };
    const ok = await run(() => {
      if (mode === 'new') return api('POST', `/api/reports/${report.id}/projects`, { ...body, project_id: undefined });
      if (mode === 'existing') return api('POST', `/api/reports/${report.id}/projects`, body);
      if (mode === 'project') return api('PATCH', `/api/reports/${report.id}/projects`, { ...body, kind: 'project', id: row!.project_id, version: row!.project_version });
      return api('PATCH', `/api/reports/${report.id}/projects`, { ...body, kind: 'monthly', id: row!.id, version: row!.version });
    }, '저장했습니다.');
    if (ok) setPjModal(null);
  };
  const delPj = (row: ReportProject) => { if (confirm('이 보고서에서 과제의 금월 기록을 뺄까요?\n(다른 달 기록이 없는 과제는 기본 정보도 함께 삭제됩니다.)')) run(() => api('DELETE', `/api/reports/${report.id}/projects?monthly=${row.id}`), '삭제했습니다.'); };

  // ── 첨부 ──
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      const fd = new FormData(); fd.append('file', f);
      const ok = await run(() => api('POST', `/api/reports/${report.id}/attachments`, fd), `${f.name} 첨부 완료`);
      if (!ok) break;
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const flowIdx = REPORT_FLOW.indexOf(report.status === 'rejected' ? 'draft' : report.status);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const setP = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setPj((d) => ({ ...d, [k]: e.target.value }));
  const th = 'border-b border-slate-200 bg-slate-50 px-2.5 py-2 text-left text-xs font-semibold text-slate-600 whitespace-nowrap';
  const td = 'border-b border-slate-100 px-2.5 py-2 align-top text-sm text-slate-800';

  const cell = (it: ReportItem, k: ItemField) => {
    switch (k) {
      case 'product_id': return pLabel(it.product_name, it.product_model) || <span className="text-slate-400">-</span>;
      case 'category_id': return it.category_name ?? <span className="text-slate-400">-</span>;
      case 'status': return <ItemBadge status={it.status} />;
      case 'quantity': return it.quantity === null ? '' : fmtNum(it.quantity, 2);
      case 'change_note': case 'content': return <span className="whitespace-pre-wrap break-words">{it[k]}</span>;
      default: return String(it[k] ?? '');
    }
  };

  return (
    <div className="space-y-4">
      {/* 머리말 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{report.year}년 {report.month}월 월차보고</h1>
            <ReportBadge status={report.status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">작성자 {report.user_name}{report.submitted_at && ` · 제출 ${fmtDateTime(report.submitted_at)}`} · 최근 수정 {fmtDateTime(report.updated_at)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOwner && editable && <Button variant="primary" disabled={busy} onClick={() => transition('submit', '제출했습니다.', `${report.year}년 ${report.month}월 월차보고를 제출할까요?\n제출 후에는 관리자 검토 전까지만 취소할 수 있습니다.`)}>{report.status === 'rejected' ? '재제출' : '제출'}</Button>}
          {isOwner && report.status === 'submitted' && <Button disabled={busy} onClick={() => transition('cancel', '제출을 취소했습니다.', '제출을 취소하고 작성중 상태로 되돌릴까요?')}>제출 취소</Button>}
          {isAdmin && report.status === 'submitted' && <Button variant="primary" disabled={busy} onClick={() => transition('review', '관리자 확인 처리했습니다.')}>관리자 확인</Button>}
          {isAdmin && report.status === 'reviewed' && <Button variant="primary" disabled={busy} onClick={() => transition('finalize', '최종확정했습니다.', '이 보고서를 최종확정할까요?')}>최종확정</Button>}
          {isAdmin && ['submitted', 'reviewed', 'finalized'].includes(report.status) && <Button variant="danger" disabled={busy} onClick={() => { setReason(''); setRejectOpen(true); }}>반려</Button>}
          <ExportMenu base={`/api/export/report/${report.id}`} />
        </div>
      </div>

      {/* 진행 단계 */}
      <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="보고서 진행 단계">
        {REPORT_FLOW.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            <span className={cn('rounded-full px-2.5 py-1 font-medium ring-1 ring-inset', i < flowIdx ? 'bg-blue-50 text-blue-700 ring-blue-200' : i === flowIdx ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-500 ring-slate-300')} aria-current={i === flowIdx ? 'step' : undefined}>
              {i + 1}. {REPORT_STATUS[s].label}
            </span>
            {i < REPORT_FLOW.length - 1 && <span aria-hidden className="text-slate-400">→</span>}
          </li>
        ))}
      </ol>

      {report.status === 'rejected' && (
        <div role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <div className="font-semibold">반려된 보고서입니다{report.rejected_at && ` (${fmtDateTime(report.rejected_at)})`}</div>
          <div className="mt-1 whitespace-pre-wrap">사유: {report.reject_reason}</div>
          {isOwner && <div className="mt-1 text-xs">내용을 수정한 뒤 [재제출]을 눌러 주세요.</div>}
        </div>
      )}
      {isOwner && !editable && <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">제출된 보고서는 수정할 수 없습니다.{report.status === 'submitted' && ' 수정하려면 [제출 취소]를 눌러 주세요.'}</div>}

      {/* 요약 */}
      <Card title="요약" actions={editable && <Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={busy || !dirty} onClick={saveSummary}>{dirty ? '요약 저장' : '저장됨'}</Button>}>
        {editable ? <Textarea rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="금월 주요 업무와 특이사항을 요약해 주세요." aria-label="요약" /> : <Multiline text={report.summary} />}
      </Card>

      {/* 섹션별 항목 */}
      {SECTIONS.slice(0, 2).map((sec) => sectionCard(sec))}

      {/* 개발과제 */}
      <Card title={`개발과제 (${projects.length})`} pad={false} actions={editable && (<><Button size="sm" onClick={() => openPj('existing')}>기존 과제 불러오기</Button><Button size="sm" variant="primary" onClick={() => openPj('new')}>새 과제 추가</Button></>)}>
        {projects.length === 0 ? <div className="p-4"><Empty>등록된 개발과제가 없습니다.</Empty></div> : (
          <ul className="divide-y divide-slate-100">
            {projects.map((p) => (
              <li key={p.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">{p.name}</div>
                    <div className="mt-0.5 text-xs text-slate-600">
                      {[pLabel(p.product_name, p.product_model), p.category_name, (p.start_date || p.end_date) && `${p.start_date ?? ''} ~ ${p.end_date ?? ''}`].filter(Boolean).join(' · ') || '기본 정보 없음'}
                    </div>
                    {p.goal && <div className="mt-1 text-xs text-slate-600">목표: {p.goal}</div>}
                  </div>
                  {editable && (
                    <div className="flex gap-1.5">
                      <Button size="sm" onClick={() => openPj('monthly', p)}>월별 진행 수정</Button>
                      <Button size="sm" onClick={() => openPj('project', p)}>기본 정보 수정</Button>
                      <Button size="sm" variant="danger" onClick={() => delPj(p)}>제외</Button>
                    </div>
                  )}
                </div>
                <div className="mt-3 grid gap-3 rounded-md bg-slate-50 p-3 text-sm sm:grid-cols-4">
                  <div>
                    <div className="text-xs font-medium text-slate-500">{report.month}월 진행률</div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-slate-200" role="progressbar" aria-valuenow={p.progress} aria-valuemin={0} aria-valuemax={100}><div className="h-2 rounded-full bg-blue-600" style={{ width: `${p.progress}%` }} /></div>
                      <span className="w-10 text-right font-semibold tabular-nums">{p.progress}%</span>
                    </div>
                    <div className="mt-1.5"><ItemBadge status={p.status} /></div>
                  </div>
                  <div><div className="text-xs font-medium text-slate-500">금월 결과</div><Multiline text={p.result} /></div>
                  <div><div className="text-xs font-medium text-slate-500">이슈</div><Multiline text={p.issue} /></div>
                  <div><div className="text-xs font-medium text-slate-500">차월 계획</div><Multiline text={p.next_plan} /></div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {SECTIONS.slice(2).map((sec) => sectionCard(sec))}

      {/* 개발현황 / 생산이관 (전용 메뉴에서 기록) */}
      <Card title={`개발현황 (${devWorks.length})`} pad={false} actions={isOwner && <Link className="text-xs text-blue-700 hover:underline" href={`/dev-status?year=${report.year}&month=${report.month}&tab=detail`}>개발현황 메뉴에서 {editable ? '편집' : '보기'} →</Link>}>
        {devWorks.length === 0 ? <div className="p-4"><Empty>이 달에 기록한 개발현황이 없습니다.</Empty></div> : (
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr>{['제품 / 모델', 'Rev.', '업무명', '상태', '진행률', '수행내용', '시험결과', '문제점 / 조치', '차월계획'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{devWorks.map((w) => (
              <tr key={w.id}>
                <td className={cn(td, 'whitespace-nowrap')}>{pLabel(w.product_name, w.product_model)}</td><td className={cn(td, 'whitespace-nowrap')}>{w.revision}</td><td className={td}>{w.title}</td>
                <td className={td}><WorkBadge status={w.status} /></td><td className={cn(td, 'whitespace-nowrap tabular-nums')}>{w.progress}%</td>
                <td className={cn(td, 'whitespace-pre-wrap')}>{w.work_done}</td><td className={cn(td, 'whitespace-pre-wrap')}>{w.test_result}</td>
                <td className={cn(td, 'whitespace-pre-wrap')}>{[w.issues, w.actions && `→ ${w.actions}`].filter(Boolean).join('\n')}</td><td className={cn(td, 'whitespace-pre-wrap')}>{w.next_plan}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      <Card title={`생산이관 (${transfers.length})`} pad={false} actions={isOwner && <Link className="text-xs text-blue-700 hover:underline" href={`/transfers?year=${report.year}&month=${report.month}&tab=detail`}>생산이관 메뉴에서 {editable ? '편집' : '보기'} →</Link>}>
        {transfers.length === 0 ? <div className="p-4"><Empty>이 달에 기록한 생산이관 내역이 없습니다.</Empty></div> : (
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr>{['제품 / 모델', '개발상태', '이관상태', '예정일', '완료일', '내용', '계획'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{transfers.map((t) => (
              <tr key={t.id}>
                <td className={cn(td, 'whitespace-nowrap')}>{pLabel(t.product_name, t.product_model)}</td><td className={td}><WorkBadge status={t.dev_status} /></td><td className={td}><WorkBadge status={t.transfer_status} /></td>
                <td className={cn(td, 'whitespace-nowrap tabular-nums')}>{t.planned_date ?? ''}</td><td className={cn(td, 'whitespace-nowrap tabular-nums')}>{t.completed_date ?? ''}</td>
                <td className={cn(td, 'whitespace-pre-wrap')}>{t.content}</td><td className={cn(td, 'whitespace-pre-wrap')}>{t.plan}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>

      {/* 첨부 */}
      <Card title={`첨부파일 (${attachments.length})`} actions={editable && (<>
        <input ref={fileRef} type="file" multiple accept={ATTACH_EXT.join(',')} className="hidden" onChange={(e) => upload(e.target.files)} aria-label="첨부파일 선택" />
        <Button size="sm" variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}>파일 첨부</Button></>)}>
        {attachments.length === 0 ? <Empty>첨부파일이 없습니다. (Excel, CSV, PowerPoint, PDF)</Empty> : (
          <ul className="divide-y divide-slate-100">
            {attachments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <a className="min-w-0 truncate text-blue-700 hover:underline" href={`/api/reports/${report.id}/attachments?attachment=${a.id}`}>{a.file_name}</a>
                <span className="flex items-center gap-3 whitespace-nowrap text-xs text-slate-500">
                  {a.size_bytes >= 1048576 ? `${(a.size_bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(a.size_bytes / 1024))} KB`} · {fmtDateTime(a.created_at)}
                  {editable && <button type="button" className="text-rose-700 hover:underline" onClick={() => { if (confirm(`${a.file_name} 첨부를 삭제할까요?`)) run(() => api('DELETE', `/api/reports/${report.id}/attachments?attachment=${a.id}`), '첨부를 삭제했습니다.'); }}>삭제</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">첨부파일은 작성자와 관리자만 내려받을 수 있습니다.</p>
      </Card>

      {/* 이력 */}
      <Card title="상태 변경 이력">
        {history.length === 0 ? <Empty>아직 상태 변경 이력이 없습니다.</Empty> : (
          <ol className="space-y-2 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="w-32 shrink-0 text-xs tabular-nums text-slate-500">{fmtDateTime(h.created_at)}</span>
                <span className="text-slate-800">{h.from_status ? REPORT_STATUS[h.from_status].label : '-'} → <b>{REPORT_STATUS[h.to_status].label}</b></span>
                <span className="text-xs text-slate-500">{h.actor_name ?? ''}</span>
                {h.reason && <span className="w-full pl-32 text-xs text-rose-800 sm:w-auto sm:pl-0">사유: {h.reason}</span>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* 반려 모달 */}
      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="보고서 반려"
        footer={<><Button onClick={() => setRejectOpen(false)}>취소</Button><Button variant="danger" disabled={busy || !reason.trim()} onClick={async () => { if (await transition('reject', '반려했습니다.', undefined, { reason })) setRejectOpen(false); }}>반려</Button></>}>
        <Field label="반려 사유" required hint="작성자에게 알림으로 전달되고 이력에 남습니다."><Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      </Modal>

      {/* 항목 모달 */}
      {itemModal && (() => {
        const sec = SECTIONS.find((s) => s.key === itemModal.section)!;
        return (
          <Modal open onClose={() => setItemModal(null)} title={`${sec.label} ${itemModal.item ? '수정' : '추가'}`}
            footer={<><Button onClick={() => setItemModal(null)}>취소</Button><Button variant="primary" disabled={busy} onClick={saveItem}>저장</Button></>}>
            <div className="grid gap-3 sm:grid-cols-2">
              {sec.fields.map((f) => (
                <Field key={f.key} label={f.label} required={f.required} className={f.long || f.key === 'note' || f.key === 'title' || f.key === 'item_name' ? 'sm:col-span-2' : ''}>
                  {f.key === 'product_id' ? (
                    <Select value={draft.product_id ?? ''} onChange={set('product_id')}><option value="">선택 안 함</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{pLabel(p.name, p.model)}</option>)}
                      {itemModal.item?.product_id && !products.some((p) => p.id === itemModal.item!.product_id) && <option value={itemModal.item.product_id}>{pLabel(itemModal.item.product_name, itemModal.item.product_model)} (삭제된 제품)</option>}
                    </Select>
                  ) : f.key === 'category_id' ? (
                    <Select value={draft.category_id ?? ''} onChange={set('category_id')}><option value="">선택 안 함</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                  ) : f.key === 'status' ? (
                    <Select value={draft.status ?? 'in_progress'} onChange={set('status')}>{ITEM_STATUS_KEYS.map((s) => <option key={s} value={s}>{ITEM_STATUS[s].label}</option>)}</Select>
                  ) : f.key === 'quantity' ? (
                    <Input type="number" step="any" value={draft.quantity ?? ''} onChange={set('quantity')} />
                  ) : f.long ? (
                    <Textarea value={draft[f.key] ?? ''} onChange={set(f.key)} />
                  ) : (
                    <Input value={draft[f.key] ?? ''} onChange={set(f.key)} placeholder={f.key === 'revision' ? '예: Rev.B' : f.key === 'unit' ? 'EA, SET 등' : f.key === 'schedule' ? '예: 11/20 입고' : undefined} />
                  )}
                </Field>
              ))}
            </div>
          </Modal>
        );
      })()}

      {/* 개발과제 모달 */}
      {pjModal && (
        <Modal open onClose={() => setPjModal(null)} wide={pjModal.mode === 'new'}
          title={{ new: '새 개발과제 추가', existing: '기존 과제 불러오기', project: '과제 기본 정보 수정', monthly: `${report.month}월 진행률·결과 수정` }[pjModal.mode]}
          footer={<><Button onClick={() => setPjModal(null)}>취소</Button><Button variant="primary" disabled={busy || (pjModal.mode === 'existing' && !pj.project_id)} onClick={savePj}>저장</Button></>}>
          <div className="space-y-4">
            {pjModal.mode === 'existing' && (pickList.length === 0 ? <Empty>불러올 수 있는 기존 과제가 없습니다.</Empty> : (
              <Field label="과제 선택" required>
                <Select value={pj.project_id ?? ''} onChange={(e) => { const p = pickList.find((x) => x.id === e.target.value); setPj((d) => ({ ...d, project_id: e.target.value, progress: String(p?.last_progress ?? 0) })); }}>
                  {pickList.map((p) => <option key={p.id} value={p.id}>{p.name}{p.last_progress !== null ? ` (이전 진행률 ${p.last_progress}%)` : ''}</option>)}
                </Select>
              </Field>
            ))}
            {(pjModal.mode === 'new' || pjModal.mode === 'project') && (
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="mb-2 text-xs font-semibold text-slate-500">과제 기본 정보</legend>
                <Field label="과제명" required className="sm:col-span-2"><Input value={pj.name ?? ''} onChange={setP('name')} /></Field>
                <Field label="제품"><Select value={pj.product_id ?? ''} onChange={setP('product_id')}><option value="">선택 안 함</option>{products.map((p) => <option key={p.id} value={p.id}>{pLabel(p.name, p.model)}</option>)}</Select></Field>
                <Field label="업무 분류"><Select value={pj.category_id ?? ''} onChange={setP('category_id')}><option value="">선택 안 함</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
                <Field label="시작일"><Input type="date" value={pj.start_date ?? ''} onChange={setP('start_date')} /></Field>
                <Field label="종료일"><Input type="date" value={pj.end_date ?? ''} onChange={setP('end_date')} /></Field>
                <Field label="과제 목표" className="sm:col-span-2"><Textarea value={pj.goal ?? ''} onChange={setP('goal')} /></Field>
              </fieldset>
            )}
            {pjModal.mode !== 'project' && !(pjModal.mode === 'existing' && pickList.length === 0) && (
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="mb-2 text-xs font-semibold text-slate-500">{report.year}년 {report.month}월 진행률·결과</legend>
                <Field label="진행률 (%)"><Input type="number" min={0} max={100} value={pj.status === 'done' ? '100' : pj.progress ?? '0'} disabled={pj.status === 'done'} onChange={setP('progress')} /></Field>
                <Field label="상태"><Select value={pj.status ?? 'in_progress'} onChange={setP('status')}>{ITEM_STATUS_KEYS.map((s) => <option key={s} value={s}>{ITEM_STATUS[s].label}</option>)}</Select></Field>
                <Field label="금월 결과" className="sm:col-span-2"><Textarea value={pj.result ?? ''} onChange={setP('result')} /></Field>
                <Field label="이슈"><Textarea value={pj.issue ?? ''} onChange={setP('issue')} /></Field>
                <Field label="차월 계획"><Textarea value={pj.next_plan ?? ''} onChange={setP('next_plan')} /></Field>
              </fieldset>
            )}
          </div>
        </Modal>
      )}
    </div>
  );

  function sectionCard(sec: (typeof SECTIONS)[number]) {
    const list = items.filter((i) => i.section === sec.key);
    return (
      <Card key={sec.key} title={`${sec.label} (${list.length})`} pad={false} actions={editable && <Button size="sm" variant="primary" onClick={() => openItem(sec.key, null)}>추가</Button>}>
        {list.length === 0 ? <div className="p-4"><Empty>등록된 내용이 없습니다.</Empty></div> : (
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr>{sec.fields.map((f) => <th key={f.key} className={th}>{f.label}</th>)}{editable && <th className={cn(th, 'w-24 text-right')}>관리</th>}</tr></thead>
            <tbody>{list.map((it) => (
              <tr key={it.id}>
                {sec.fields.map((f) => <td key={f.key} className={cn(td, !f.long && f.key !== 'note' && f.key !== 'title' && 'whitespace-nowrap', f.key === 'quantity' && 'text-right tabular-nums')}>{cell(it, f.key)}</td>)}
                {editable && <td className={cn(td, 'whitespace-nowrap text-right')}>
                  <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => openItem(sec.key, it)}>수정</button>
                  <button type="button" className="ml-2 text-xs text-rose-700 hover:underline" onClick={() => delItem(it)}>삭제</button>
                </td>}
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
    );
  }
}
