'use client';
// 업무분류 관리: 목록, 추가, 수정, 삭제
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, useToast } from '../ui';
import { DataTable, type Column } from '../DataTable';
import type { Category } from '@/lib/data';

type Dialog = { type: 'create' } | { type: 'edit'; c: Category } | { type: 'delete'; c: Category } | null;

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const nextOrder = categories.reduce((m, c) => Math.max(m, c.sort_order), 0) + 10;

  const columns: Column<Category>[] = [
    { key: 'name', label: '이름', width: 220, render: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'sort_order', label: '정렬 순서', width: 100, align: 'right' },
    { key: 'is_active', label: '사용 여부', width: 110, filter: true, value: (c) => (c.is_active ? '사용' : '사용 안 함'),
      render: (c) => <Badge cls={c.is_active ? 'bg-emerald-100 text-emerald-800 ring-emerald-300' : 'bg-slate-100 text-slate-600 ring-slate-300'}>{c.is_active ? '사용' : '사용 안 함'}</Badge> },
    { key: 'actions', label: '관리', width: 130, sortable: false, value: () => '',
      render: (c) => (
        <span className="inline-flex gap-1.5">
          <Button size="sm" onClick={() => setDialog({ type: 'edit', c })}>수정</Button>
          <Button size="sm" variant="danger" onClick={() => setDialog({ type: 'delete', c })}>삭제</Button>
        </span>
      ) },
  ];

  return (
    <div>
      <PageHeader title="업무분류 관리" desc="보고서와 업무 기록에서 선택하는 업무 분류입니다. 정렬 순서가 작은 것부터 선택 목록에 나옵니다."
        actions={<Button variant="primary" onClick={() => setDialog({ type: 'create' })}>분류 추가</Button>} />
      <Card>
        <DataTable id="categories" rows={categories} columns={columns} rowKey={(c) => c.id} pageSize={50} searchPlaceholder="분류 이름 검색" empty="등록된 업무분류가 없습니다."
          initialSort={{ key: 'sort_order', dir: 'asc' }} />
      </Card>
      {(dialog?.type === 'create' || dialog?.type === 'edit') && <CategoryDialog category={dialog.type === 'edit' ? dialog.c : null} nextOrder={nextOrder} onClose={close} />}
      {dialog?.type === 'delete' && <DeleteDialog category={dialog.c} onClose={close} />}
    </div>
  );
}

function ErrorLine({ msg }: { msg: string }) {
  return msg ? <div role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{msg}</div> : null;
}

function CategoryDialog({ category, nextOrder, onClose }: { category: Category | null; nextOrder: number; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? '');
  const [order, setOrder] = useState(String(category?.sort_order ?? Math.min(nextOrder, 9999)));
  const [active, setActive] = useState(category?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const body = { name, sort_order: order === '' ? 0 : Number(order), is_active: active };
      if (category) await api('PATCH', `/api/admin/categories/${category.id}`, body);
      else await api('POST', '/api/admin/categories', body);
      toast(category ? '업무분류를 저장했습니다.' : '업무분류를 추가했습니다.');
      onClose();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={category ? '업무분류 수정' : '업무분류 추가'}
      footer={<><Button onClick={onClose} disabled={busy}>취소</Button><Button variant="primary" type="submit" form="category-form" disabled={busy}>{busy ? '저장 중…' : category ? '저장' : '추가'}</Button></>}>
      <form id="category-form" onSubmit={submit} className="space-y-3">
        <ErrorLine msg={err} />
        <Field label="이름" required><Input required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="정렬 순서" hint="0~9999. 작은 숫자가 먼저 나옵니다."><Input type="number" min={0} max={9999} step={1} value={order} onChange={(e) => setOrder(e.target.value)} /></Field>
          <Field label="사용 여부" hint="사용 안 함으로 두면 새 기록의 선택 목록에서 빠집니다.">
            <Select value={active ? '1' : '0'} onChange={(e) => setActive(e.target.value === '1')}>
              <option value="1">사용</option>
              <option value="0">사용 안 함</option>
            </Select>
          </Field>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ category, onClose }: { category: Category; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try {
      await api('DELETE', `/api/admin/categories/${category.id}`);
      toast('업무분류를 삭제했습니다.');
      onClose();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="업무분류 삭제"
      footer={<><Button onClick={onClose} disabled={busy}>취소</Button><Button variant="danger" onClick={run} disabled={busy}>{busy ? '삭제 중…' : '삭제'}</Button></>}>
      <div className="space-y-3 text-sm text-slate-700">
        <ErrorLine msg={err} />
        <p><span className="font-semibold text-slate-900">{category.name}</span> 분류를 삭제할까요?</p>
        <ul className="list-disc space-y-1 pl-5 text-slate-600">
          <li>이 분류를 쓰던 보고 항목·개발과제·개발 업무는 지워지지 않고, 분류만 빈 값이 됩니다.</li>
          <li>삭제는 되돌릴 수 없습니다. 기록의 분류를 남겨 두려면 삭제 대신 [사용 안 함]으로 바꿔 주세요.</li>
        </ul>
      </div>
    </Modal>
  );
}
