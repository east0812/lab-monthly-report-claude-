'use client';
// 모델별 24개월 타임라인 표 (직전 연도 + 선택 연도). 기록이 없는 달은 빈칸.
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn, Input, Select } from './ui';
import { WORK_STATUS, WORK_STATUS_KEYS, type WorkStatus } from '@/lib/constants';
import type { TimelineRow, TimelineRecord } from '@/lib/data';

type Props = {
  /** 열 너비 저장 키 (표별로 다르게) */
  tableId: string;
  year: number;
  rows: TimelineRow[];
  /** 강조할 보고 월 */
  highlight?: { year: number; month: number };
  /** 기록이 있는 칸을 눌렀을 때. clickable 로 누를 수 있는 칸을 제한할 수 있다. */
  onCellClick?: (row: TimelineRow, year: number, month: number, records: TimelineRecord[]) => void;
  clickable?: (year: number, month: number, records: TimelineRecord[]) => boolean;
  pageSize?: number;
  empty?: string;
};

export function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
      {WORK_STATUS_KEYS.map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className={cn('inline-flex h-5 min-w-9 items-center justify-center rounded px-1 text-[11px] font-semibold ring-1 ring-inset', WORK_STATUS[s].cls)}>{WORK_STATUS[s].mark} {WORK_STATUS[s].short}</span>
        </span>
      ))}
      <span className="text-slate-400">빈칸 = 기록 없음</span>
    </div>
  );
}

export function Timeline({ tableId, year, rows, highlight, onCellClick, clickable, pageSize = 15, empty = '기록이 없습니다.' }: Props) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | WorkStatus>('');
  const [sortBy, setSortBy] = useState<'model' | 'owner'>('model');
  const [page, setPage] = useState(1);
  const [w, setW] = useState<{ model: number; owner: number }>({ model: 190, owner: 76 });
  const storeKey = `tbl-width:${tableId}`;
  useEffect(() => { try { const raw = localStorage.getItem(storeKey); if (raw) setW((p) => ({ ...p, ...JSON.parse(raw) })); } catch {} }, [storeKey]);

  const months = useMemo(() => {
    const out: { y: number; m: number; k: string }[] = [];
    for (const y of [year - 1, year]) for (let m = 1; m <= 12; m++) out.push({ y, m, k: `${y}-${String(m).padStart(2, '0')}` });
    return out;
  }, [year]);
  const hk = highlight ? `${highlight.year}-${String(highlight.month).padStart(2, '0')}` : '';

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (needle && !`${r.product_name} ${r.model} ${r.user_name}`.toLowerCase().includes(needle)) return false;
      if (status) {
        const cells = hk && r.cells[hk] ? [r.cells[hk]] : Object.values(r.cells);
        if (!cells.some((c) => c.some((x) => x.status === status))) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => sortBy === 'owner'
      ? a.user_name.localeCompare(b.user_name, 'ko') || a.product_name.localeCompare(b.product_name, 'ko')
      : `${a.product_name} ${a.model}`.localeCompare(`${b.product_name} ${b.model}`, 'ko', { numeric: true }) || a.user_name.localeCompare(b.user_name, 'ko'));
  }, [rows, q, status, sortBy, hk]);
  useEffect(() => setPage(1), [q, status, sortBy]);
  const pages = Math.max(1, Math.ceil(view.length / pageSize));
  const cur = Math.min(page, pages);
  const pageRows = view.slice((cur - 1) * pageSize, cur * pageSize);

  const drag = useRef<{ key: 'model' | 'owner'; x: number; w: number } | null>(null);
  const startDrag = (e: React.PointerEvent, key: 'model' | 'owner') => {
    e.preventDefault();
    drag.current = { key, x: e.clientX, w: w[key] };
    const move = (ev: PointerEvent) => { if (drag.current) { const d = drag.current; setW((p) => ({ ...p, [d.key]: Math.max(56, Math.round(d.w + ev.clientX - d.x)) })); } };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); drag.current = null;
      setW((p) => { try { localStorage.setItem(storeKey, JSON.stringify(p)); } catch {} return p; });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const CELL = 46;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제품·모델·담당자 검색" aria-label="타임라인 검색" className="!h-8 !w-48 text-xs" />
        <Select aria-label="상태 필터" value={status} onChange={(e) => setStatus(e.target.value as WorkStatus | '')} className="!h-8 !w-auto text-xs">
          <option value="">상태: 전체</option>
          {WORK_STATUS_KEYS.map((s) => <option key={s} value={s}>{WORK_STATUS[s].label}</option>)}
        </Select>
        <Select aria-label="정렬" value={sortBy} onChange={(e) => setSortBy(e.target.value as 'model' | 'owner')} className="!h-8 !w-auto text-xs">
          <option value="model">정렬: 모델순</option>
          <option value="owner">정렬: 담당자순</option>
        </Select>
        <div className="ml-auto"><StatusLegend /></div>
      </div>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="border-collapse text-xs" style={{ tableLayout: 'fixed', width: w.model + w.owner + CELL * 24 }}>
          <colgroup>
            <col style={{ width: w.model }} /><col style={{ width: w.owner }} />
            {months.map((c) => <col key={c.k} style={{ width: CELL }} />)}
          </colgroup>
          <thead className="text-slate-600">
            <tr className="bg-slate-50">
              <th rowSpan={2} scope="col" className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-left font-semibold">
                <div className="relative">제품 / 모델<span role="separator" aria-label="모델 열 너비 조절" onPointerDown={(e) => startDrag(e, 'model')} className="absolute -right-2 -top-1.5 h-9 w-1.5 cursor-col-resize touch-none hover:bg-blue-300" /></div>
              </th>
              <th rowSpan={2} scope="col" className="border-b border-r border-slate-200 px-2 py-1.5 text-left font-semibold">
                <div className="relative">담당자<span role="separator" aria-label="담당자 열 너비 조절" onPointerDown={(e) => startDrag(e, 'owner')} className="absolute -right-2 -top-1.5 h-9 w-1.5 cursor-col-resize touch-none hover:bg-blue-300" /></div>
              </th>
              <th colSpan={12} scope="colgroup" className="border-b border-r-2 border-slate-200 border-r-slate-300 px-2 py-1 text-center font-semibold">{year - 1}년</th>
              <th colSpan={12} scope="colgroup" className="border-b border-slate-200 px-2 py-1 text-center font-semibold">{year}년</th>
            </tr>
            <tr className="bg-slate-50">
              {months.map((c) => (
                <th key={c.k} scope="col" className={cn('border-b border-slate-200 px-0 py-1 text-center font-medium tabular-nums', c.m === 12 && c.y === year - 1 && 'border-r-2 border-r-slate-300', c.k === hk && 'bg-blue-600 text-white')}>{c.m}월</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && <tr><td colSpan={26} className="px-4 py-8 text-center text-sm text-slate-500">{empty}</td></tr>}
            {pageRows.map((r) => (
              <tr key={r.key} className="border-b border-slate-100 last:border-b-0">
                <th scope="row" title={`${r.product_name} ${r.model}`} className="sticky left-0 z-10 truncate border-r border-slate-200 bg-white px-2 py-1 text-left font-medium text-slate-800">
                  {r.product_name}{r.model && <span className="ml-1 font-normal text-slate-500">{r.model}</span>}
                </th>
                <td title={r.user_name} className="truncate border-r border-slate-200 px-2 py-1 text-slate-700">{r.user_name}</td>
                {months.map((c) => {
                  const recs = r.cells[c.k];
                  const can = !!recs && !!onCellClick && (clickable ? clickable(c.y, c.m, recs) : true);
                  const first = recs?.[0];
                  const st = first ? WORK_STATUS[first.status] : null;
                  const tip = recs ? `${c.y}년 ${c.m}월 · ${r.product_name} ${r.model}\n` + recs.map((x) => `${WORK_STATUS[x.status].label}${x.title ? ` · ${x.title}` : ''}${x.progress !== null && x.progress !== undefined ? ` (${x.progress}%)` : ''}`).join('\n') : undefined;
                  const inner = st && (
                    <span className={cn('inline-flex h-5 w-full items-center justify-center gap-0.5 rounded px-0.5 text-[11px] font-semibold ring-1 ring-inset', st.cls)}>
                      <span aria-hidden>{st.mark}</span>{st.short}{recs!.length > 1 && <sup className="font-bold">+{recs!.length - 1}</sup>}
                    </span>
                  );
                  return (
                    <td key={c.k} title={tip} className={cn('px-0.5 py-1 text-center', c.m === 12 && c.y === year - 1 && 'border-r-2 border-r-slate-300', c.k === hk && 'bg-blue-50')}>
                      {can ? (
                        <button type="button" aria-label={`${c.y}년 ${c.m}월 ${r.product_name} ${r.model} ${r.user_name} 상태 ${st?.label} 수정`} onClick={() => onCellClick!(r, c.y, c.m, recs!)}
                          className="block w-full rounded outline-offset-1 hover:ring-2 hover:ring-blue-400 focus-visible:outline-2 focus-visible:outline-blue-600">{inner}</button>
                      ) : inner}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
        <span>{view.length}개 행{view.length !== rows.length && ` (전체 ${rows.length}개 중)`}</span>
        <div className="flex items-center gap-1.5">
          <button type="button" className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40" disabled={cur <= 1} onClick={() => setPage(cur - 1)} aria-label="이전 페이지">‹</button>
          <span className="px-1 tabular-nums">{cur} / {pages}</span>
          <button type="button" className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40" disabled={cur >= pages} onClick={() => setPage(cur + 1)} aria-label="다음 페이지">›</button>
        </div>
      </div>
    </div>
  );
}
