'use client';
// 제품 개발이력: 제품 선택 목록 (이름·모델·제품군으로 걸러 고른다)
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { cn, Input } from '../ui';

export type PickerProduct = { id: string; name: string; model: string; family: string; deleted: boolean };

export function ProductPicker({ products, selectedId }: { products: PickerProduct[]; selectedId: string | null }) {
  const [q, setQ] = useState('');
  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return products;
    return products.filter((p) => `${p.name} ${p.model} ${p.family}`.toLowerCase().includes(needle));
  }, [products, q]);

  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제품명·모델 검색" aria-label="제품 검색" className="mb-2" />
      <ul className="max-h-56 overflow-y-auto rounded-md border border-slate-200 lg:max-h-[calc(100vh-17rem)]" aria-label="제품 목록">
        {view.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">조건에 맞는 제품이 없습니다.</li>}
        {view.map((p) => {
          const on = p.id === selectedId;
          return (
            <li key={p.id} className="border-b border-slate-100 last:border-b-0">
              <Link href={`/history/products?product=${p.id}`} aria-current={on ? 'true' : undefined} scroll={false}
                className={cn('block px-3 py-2 text-sm', on ? 'bg-blue-600 text-white' : 'text-slate-800 hover:bg-blue-50')}>
                <span className="flex items-center justify-between gap-2">
                  <span className={cn('min-w-0 truncate font-medium', p.deleted && !on && 'text-slate-500')}>{p.name}</span>
                  {p.deleted && <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[11px] ring-1 ring-inset', on ? 'bg-white/20 text-white ring-white/40' : 'bg-rose-50 text-rose-700 ring-rose-200')}>삭제됨</span>}
                </span>
                <span className={cn('block truncate text-xs', on ? 'text-blue-100' : 'text-slate-500')}>{[p.model, p.family].filter(Boolean).join(' · ') || '모델 미지정'}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-slate-500">전체 {products.length}개{view.length !== products.length && ` 중 ${view.length}개 표시`}</p>
    </div>
  );
}
