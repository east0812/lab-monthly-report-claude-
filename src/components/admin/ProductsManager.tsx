'use client';
// 제품 관리: 목록, 등록·수정, 삭제(복원 가능)·복원, Revision 이력
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Textarea, useToast } from '../ui';
import { DataTable, type Column } from '../DataTable';
import { fmtDateTime } from '@/lib/constants';
import { productLabel, type Product } from '@/lib/data';

type Dialog = { type: 'create' } | { type: 'edit'; p: Product } | { type: 'delete'; p: Product } | { type: 'revisions'; p: Product } | null;
type Revision = { id: string; revision: string; prev_revision: string | null; changed_by_name: string | null; changed_at: string };

export function ProductsManager({ products }: { products: Product[] }) {
  const router = useRouter();
  const toast = useToast();
  const [showDeleted, setShowDeleted] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busyId, setBusyId] = useState('');
  const close = () => setDialog(null);
  const deletedCount = products.filter((p) => p.deleted_at).length;
  const view = showDeleted ? products : products.filter((p) => !p.deleted_at);

  const restore = async (p: Product) => {
    setBusyId(p.id);
    try {
      await api('PATCH', `/api/admin/products/${p.id}`, { action: 'restore', version: p.version });
      toast('제품을 복원했습니다.');
      router.refresh();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
    setBusyId('');
  };

  const columns: Column<Product>[] = [
    { key: 'name', label: '제품명', width: 180, render: (p) => <span className={p.deleted_at ? 'text-slate-500 line-through' : 'font-medium'}>{p.name}</span> },
    { key: 'model', label: '모델', width: 130 },
    { key: 'family', label: '제품군', width: 110, filter: true },
    { key: 'freq_band', label: '주파수대역', width: 130 },
    { key: 'revision', label: 'Revision', width: 90 },
    { key: 'note', label: '비고', width: 180, value: (p) => p.note.replace(/\s+/g, ' ') },
    { key: 'state', label: '상태', width: 90, value: (p) => (p.deleted_at ? '삭제됨' : '사용'),
      render: (p) => <Badge cls={p.deleted_at ? 'bg-rose-100 text-rose-800 ring-rose-300' : 'bg-emerald-100 text-emerald-800 ring-emerald-300'}>{p.deleted_at ? '삭제됨' : '사용'}</Badge> },
    { key: 'updated_at', label: '수정일', width: 140, value: (p) => fmtDateTime(p.updated_at) },
    { key: 'actions', label: '관리', width: 240, sortable: false, value: () => '',
      render: (p) => (
        <span className="inline-flex gap-1.5">
          <Button size="sm" onClick={() => setDialog({ type: 'edit', p })}>수정</Button>
          <Button size="sm" onClick={() => setDialog({ type: 'revisions', p })}>Revision 이력</Button>
          {p.deleted_at
            ? <Button size="sm" disabled={busyId === p.id} onClick={() => restore(p)}>복원</Button>
            : <Button size="sm" variant="danger" onClick={() => setDialog({ type: 'delete', p })}>삭제</Button>}
        </span>
      ) },
  ];

  return (
    <div>
      <PageHeader title="제품 관리" desc="보고서와 업무 기록에서 선택하는 제품(모델)을 관리합니다. 삭제한 제품은 복원할 수 있고 기존 이력은 보존됩니다."
        actions={<Button variant="primary" onClick={() => setDialog({ type: 'create' })}>제품 등록</Button>} />
      <Card>
        <DataTable id="products" rows={view} columns={columns} rowKey={(p) => p.id} searchPlaceholder="제품명·모델·Revision 검색" empty="등록된 제품이 없습니다."
          toolbar={
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
              <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
              삭제된 제품 포함{deletedCount > 0 && ` (${deletedCount})`}
            </label>
          } />
      </Card>
      {(dialog?.type === 'create' || dialog?.type === 'edit') && <ProductDialog product={dialog.type === 'edit' ? dialog.p : null} onClose={close} />}
      {dialog?.type === 'delete' && <DeleteDialog product={dialog.p} onClose={close} />}
      {dialog?.type === 'revisions' && <RevisionsDialog product={dialog.p} onClose={close} />}
    </div>
  );
}

function ErrorLine({ msg }: { msg: string }) {
  return msg ? <div role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{msg}</div> : null;
}

function ProductDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({
    name: product?.name ?? '', model: product?.model ?? '', family: product?.family ?? '',
    freq_band: product?.freq_band ?? '', revision: product?.revision ?? '', note: product?.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      if (product) await api('PATCH', `/api/admin/products/${product.id}`, { ...f, version: product.version });
      else await api('POST', '/api/admin/products', f);
      toast(product ? '제품 정보를 저장했습니다.' : '제품을 등록했습니다.');
      onClose();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={product ? '제품 수정' : '제품 등록'}
      footer={<><Button onClick={onClose} disabled={busy}>취소</Button><Button variant="primary" type="submit" form="product-form" disabled={busy}>{busy ? '저장 중…' : product ? '저장' : '등록'}</Button></>}>
      <form id="product-form" onSubmit={submit} className="space-y-3">
        <ErrorLine msg={err} />
        {product?.deleted_at && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">삭제된 제품입니다. 수정한 뒤 목록에서 [복원]을 누르면 다시 사용할 수 있습니다.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="제품명" required><Input required maxLength={100} value={f.name} onChange={set('name')} autoFocus /></Field>
          <Field label="모델"><Input maxLength={100} value={f.model} onChange={set('model')} /></Field>
          <Field label="제품군"><Input maxLength={100} value={f.family} onChange={set('family')} placeholder="예: 증폭기" /></Field>
          <Field label="주파수대역"><Input maxLength={100} value={f.freq_band} onChange={set('freq_band')} placeholder="예: 2~6 GHz" /></Field>
          <Field label="Revision" hint={product ? 'Revision 을 바꾸면 변경 이력이 자동으로 남습니다.' : undefined}><Input maxLength={50} value={f.revision} onChange={set('revision')} placeholder="예: Rev.A" /></Field>
        </div>
        <Field label="비고"><Textarea maxLength={1000} value={f.note} onChange={set('note')} /></Field>
      </form>
    </Modal>
  );
}

function DeleteDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try {
      await api('PATCH', `/api/admin/products/${product.id}`, { action: 'delete', version: product.version });
      toast('제품을 삭제했습니다. [삭제된 제품 포함]을 켜면 복원할 수 있습니다.');
      onClose();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="제품 삭제"
      footer={<><Button onClick={onClose} disabled={busy}>취소</Button><Button variant="danger" onClick={run} disabled={busy}>{busy ? '삭제 중…' : '삭제'}</Button></>}>
      <div className="space-y-3 text-sm text-slate-700">
        <ErrorLine msg={err} />
        <p><span className="font-semibold text-slate-900">{productLabel(product)}</span> 제품을 삭제할까요?</p>
        <ul className="list-disc space-y-1 pl-5 text-slate-600">
          <li>기존 보고서와 업무 이력은 보존됩니다. 제품 개발이력에서도 계속 볼 수 있습니다.</li>
          <li>삭제한 제품은 새 보고서·업무를 작성할 때 선택 목록에 나오지 않습니다.</li>
          <li>[삭제된 제품 포함]을 켠 뒤 [복원]을 누르면 언제든 되돌릴 수 있습니다.</li>
        </ul>
      </div>
    </Modal>
  );
}

function RevisionsDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const [rows, setRows] = useState<Revision[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    api<{ revisions: Revision[] }>('GET', `/api/admin/products/${product.id}/revisions`)
      .then((r) => { if (alive) setRows(r.revisions); })
      .catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [product.id]);
  return (
    <Modal open onClose={onClose} title={`Revision 이력 · ${productLabel(product)}`} footer={<Button onClick={onClose}>닫기</Button>}>
      <p className="mb-3 text-sm text-slate-600">현재 Revision: <span className="font-semibold text-slate-900">{product.revision || '(없음)'}</span></p>
      <ErrorLine msg={err} />
      {!err && rows === null && <p className="py-6 text-center text-sm text-slate-500">불러오는 중…</p>}
      {rows && rows.length === 0 && <Empty>Revision 변경 이력이 없습니다.</Empty>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-600">
                <th scope="col" className="border-b border-slate-200 px-3 py-2 font-semibold">Revision</th>
                <th scope="col" className="border-b border-slate-200 px-3 py-2 font-semibold">이전 Revision</th>
                <th scope="col" className="border-b border-slate-200 px-3 py-2 font-semibold">변경자</th>
                <th scope="col" className="border-b border-slate-200 px-3 py-2 font-semibold">변경일</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-1.5 font-medium text-slate-900">{r.revision || '(없음)'}</td>
                  <td className="px-3 py-1.5 text-slate-600">{r.prev_revision === null ? '최초 등록' : r.prev_revision || '(없음)'}</td>
                  <td className="px-3 py-1.5 text-slate-700">{r.changed_by_name || '-'}</td>
                  <td className="px-3 py-1.5 tabular-nums text-slate-600">{fmtDateTime(r.changed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
