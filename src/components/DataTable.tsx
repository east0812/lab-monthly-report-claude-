'use client';
// 공용 표: 검색·필터·정렬·페이지 이동·열 너비 드래그 조절(브라우저에 표별로 저장)
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn, Input, Select } from './ui';

export type Column<T> = {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
  /** 정렬·검색·필터에 쓰는 값 */
  value?: (r: T) => string | number | null | undefined;
  render?: (r: T) => ReactNode;
  sortable?: boolean;
  /** 이 열의 고유 값으로 필터 선택 상자를 만든다 */
  filter?: boolean;
  /** 긴 글 줄바꿈 허용 (기본은 한 줄 표시) */
  wrap?: boolean;
};

type Props<T> = {
  id: string;
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string;
  pageSize?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  empty?: string;
  onRowClick?: (r: T) => void;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (s: Set<string>) => void;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  footer?: ReactNode;
};

export function DataTable<T>({ id, rows, columns, rowKey, pageSize = 20, searchable = true, searchPlaceholder = '표 안에서 검색', toolbar, empty = '표시할 자료가 없습니다.', onRowClick, selectable, selected, onSelectedChange, initialSort, footer }: Props<T>) {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const storeKey = `tbl-width:${id}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) setWidths(JSON.parse(raw));
    } catch {}
  }, [storeKey]);

  const valueOf = (c: Column<T>, r: T) => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]) as string | number | null | undefined;

  const filterOptions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of columns) {
      if (!c.filter) continue;
      const set = new Set<string>();
      for (const r of rows) { const v = valueOf(c, r); if (v !== null && v !== undefined && v !== '') set.add(String(v)); }
      out[c.key] = [...set].sort((a, b) => a.localeCompare(b, 'ko'));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows.filter((r) => {
      for (const [k, v] of Object.entries(filters)) {
        if (!v) continue;
        const c = columns.find((x) => x.key === k);
        if (c && String(valueOf(c, r) ?? '') !== v) return false;
      }
      if (!needle) return true;
      return columns.some((c) => String(valueOf(c, r) ?? '').toLowerCase().includes(needle));
    });
    if (sort) {
      const c = columns.find((x) => x.key === sort.key);
      if (c) {
        const dir = sort.dir === 'asc' ? 1 : -1;
        list = [...list].sort((a, b) => {
          const va = valueOf(c, a), vb = valueOf(c, b);
          if (va === vb) return 0;
          if (va === null || va === undefined || va === '') return 1;
          if (vb === null || vb === undefined || vb === '') return -1;
          if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
          return String(va).localeCompare(String(vb), 'ko', { numeric: true }) * dir;
        });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, q, filters, sort]);

  const pages = Math.max(1, Math.ceil(view.length / size));
  const cur = Math.min(page, pages);
  const pageRows = view.slice((cur - 1) * size, cur * size);
  useEffect(() => { setPage(1); }, [q, filters, size]);

  // 열 너비 드래그
  const drag = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const startDrag = (e: React.PointerEvent, key: string, w: number) => {
    e.preventDefault(); e.stopPropagation();
    drag.current = { key, startX: e.clientX, startW: w };
    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      const nw = Math.max(48, Math.round(drag.current.startW + ev.clientX - drag.current.startX));
      setWidths((p) => ({ ...p, [drag.current!.key]: nw }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      drag.current = null;
      setWidths((p) => { try { localStorage.setItem(storeKey, JSON.stringify(p)); } catch {} return p; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const resetWidths = () => { setWidths({}); try { localStorage.removeItem(storeKey); } catch {} };

  const wOf = (c: Column<T>) => widths[c.key] ?? c.width ?? 140;
  const total = columns.reduce((s, c) => s + wOf(c), 0) + (selectable ? 40 : 0);
  const allKeys = view.map(rowKey);
  const allChecked = selectable && allKeys.length > 0 && allKeys.every((k) => selected?.has(k));
  const toggleAll = () => {
    if (!onSelectedChange) return;
    const s = new Set(selected);
    if (allChecked) allKeys.forEach((k) => s.delete(k)); else allKeys.forEach((k) => s.add(k));
    onSelectedChange(s);
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {searchable && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} aria-label="표 검색" className="!h-8 !w-52 text-xs" />}
        {columns.filter((c) => c.filter).map((c) => (
          <Select key={c.key} aria-label={`${c.label} 필터`} value={filters[c.key] ?? ''} onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))} className="!h-8 !w-auto max-w-44 text-xs">
            <option value="">{c.label}: 전체</option>
            {(filterOptions[c.key] ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>
      </div>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width: total, minWidth: '100%' }}>
          <colgroup>
            {selectable && <col style={{ width: 40 }} />}
            {columns.map((c) => <col key={c.key} style={{ width: wOf(c) }} />)}
          </colgroup>
          <thead>
            <tr className="bg-slate-50 text-xs text-slate-600">
              {selectable && (
                <th className="border-b border-slate-200 px-2 py-2 text-center">
                  <input type="checkbox" aria-label="전체 선택" checked={!!allChecked} onChange={toggleAll} />
                </th>
              )}
              {columns.map((c) => {
                const sortable = c.sortable !== false;
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('relative select-none border-b border-slate-200 px-2.5 py-2 font-semibold', c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')}>
                    {sortable ? (
                      <button type="button" className="inline-flex max-w-full items-center gap-1 truncate hover:text-slate-900"
                        onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 'asc' ? { key: c.key, dir: 'desc' } : null) : { key: c.key, dir: 'asc' }))}>
                        <span className="truncate">{c.label}</span>
                        <span aria-hidden className={active ? 'text-blue-600' : 'text-slate-300'}>{active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </button>
                    ) : <span className="truncate">{c.label}</span>}
                    <span role="separator" aria-label={`${c.label} 열 너비 조절`} onPointerDown={(e) => startDrag(e, c.key, wOf(c))}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none border-r border-slate-200 hover:bg-blue-300" />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-8 text-center text-sm text-slate-500">{empty}</td></tr>
            )}
            {pageRows.map((r) => {
              const k = rowKey(r);
              return (
                <tr key={k} onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cn('border-b border-slate-100 last:border-b-0', onRowClick && 'cursor-pointer hover:bg-blue-50/60', selected?.has(k) && 'bg-blue-50')}>
                  {selectable && (
                    <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label="행 선택" checked={!!selected?.has(k)} onChange={() => {
                        if (!onSelectedChange) return;
                        const s = new Set(selected); if (s.has(k)) s.delete(k); else s.add(k); onSelectedChange(s);
                      }} />
                    </td>
                  )}
                  {columns.map((c) => {
                    const v = valueOf(c, r);
                    return (
                      <td key={c.key} title={!c.wrap && v !== null && v !== undefined ? String(v) : undefined}
                        className={cn('px-2.5 py-1.5 align-top text-slate-800', c.wrap ? 'whitespace-pre-wrap break-words' : 'truncate whitespace-nowrap', c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : 'text-left')}>
                        {c.render ? c.render(r) : (v ?? '')}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          {footer}
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>전체 {view.length.toLocaleString()}건{view.length !== rows.length && ` (전체 ${rows.length.toLocaleString()}건 중)`}{selectable && selected && selected.size > 0 && ` · 선택 ${selected.size}건`}</span>
        <div className="flex items-center gap-1.5">
          {Object.keys(widths).length > 0 && <button type="button" className="mr-2 underline hover:text-slate-900" onClick={resetWidths}>열 너비 초기화</button>}
          <Select aria-label="페이지당 행 수" value={size} onChange={(e) => setSize(Number(e.target.value))} className="!h-7 !w-auto text-xs">
            {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}행</option>)}
          </Select>
          <button type="button" className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40" disabled={cur <= 1} onClick={() => setPage(1)} aria-label="첫 페이지">«</button>
          <button type="button" className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40" disabled={cur <= 1} onClick={() => setPage(cur - 1)} aria-label="이전 페이지">‹</button>
          <span className="px-1 tabular-nums">{cur} / {pages}</span>
          <button type="button" className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40" disabled={cur >= pages} onClick={() => setPage(cur + 1)} aria-label="다음 페이지">›</button>
          <button type="button" className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40" disabled={cur >= pages} onClick={() => setPage(pages)} aria-label="마지막 페이지">»</button>
        </div>
      </div>
    </div>
  );
}
