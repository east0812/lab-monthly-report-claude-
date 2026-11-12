'use client';
// 출력 메뉴: Excel / A4 인쇄·PDF / HTML(회의·발표용, 자료 열람용)
import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui';

/** base 예: /api/export/report/<id>  또는  /api/export/compile?year=2026&month=11 */
export function ExportMenu({ base, label = '출력' }: { base: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const u = (q: string) => `${base}${base.includes('?') ? '&' : '?'}${q}`;
  const item = 'block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50';
  return (
    <div className="relative" ref={ref}>
      <Button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">{label} ▾</Button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-60 rounded-md border border-slate-200 bg-white py-1 shadow-lg" onClick={() => setOpen(false)}>
          <a role="menuitem" className={item} href={u('format=xlsx')}>Excel 파일 (.xlsx)</a>
          <a role="menuitem" className={item} href={u('format=print')} target="_blank" rel="noopener">A4 인쇄 / PDF 저장</a>
          <div className="my-1 border-t border-slate-200" />
          <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-slate-500">HTML 파일 (인터넷·로그인 없이 열람)</div>
          <a role="menuitem" className={item} href={u('format=html&mode=slides')}>회의·발표용 (16:9 슬라이드)</a>
          <a role="menuitem" className={item} href={u('format=html&mode=doc')}>자료 열람용 (문서)</a>
        </div>
      )}
    </div>
  );
}
