'use client';
// 공용 UI 부품 (버튼·입력·모달·토스트 등)
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { REPORT_STATUS, WORK_STATUS, ITEM_STATUS, type ReportStatus, type WorkStatus, type ItemStatus } from '@/lib/constants';

export const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/** JSON API 호출. 실패하면 서버가 준 안내 문구로 Error 를 던진다. */
export async function api<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(url, {
    method,
    headers: body !== undefined && !isForm ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    credentials: 'same-origin',
  });
  let data: unknown = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401) {
    if (typeof window !== 'undefined' && !location.pathname.startsWith('/login')) location.href = '/login';
    throw new Error('로그인이 필요합니다.');
  }
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `요청에 실패했습니다. (${res.status})`);
  return data as T;
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'md' };
export function Button({ variant = 'secondary', size = 'md', className, ...p }: BtnProps) {
  const v = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 border-blue-600',
    secondary: 'bg-white text-slate-700 hover:bg-slate-50 border-slate-300',
    danger: 'bg-white text-rose-700 hover:bg-rose-50 border-rose-300',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 border-transparent',
  }[variant];
  return (
    <button type="button" {...p}
      className={cn('inline-flex items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm', v, className)} />
  );
}

const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-500';
export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn(inputCls, 'h-9', className)} />;
}
export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cn(inputCls, 'h-9 pr-7', className)}>{children}</select>;
}
export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...p} className={cn(inputCls, 'py-2 leading-relaxed', className)} />;
}
export function Field({ label, hint, required, children, className }: { label: string; hint?: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}{required && <span className="text-rose-600"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Badge({ cls, children, title }: { cls: string; children: ReactNode; title?: string }) {
  return <span title={title} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', cls)}>{children}</span>;
}
export const ReportBadge = ({ status }: { status: ReportStatus | null | undefined }) =>
  status ? <Badge cls={REPORT_STATUS[status].cls}>{REPORT_STATUS[status].label}</Badge> : <Badge cls="bg-white text-slate-500 ring-slate-300">미작성</Badge>;
export const WorkBadge = ({ status }: { status: WorkStatus }) =>
  <Badge cls={WORK_STATUS[status].cls}><span aria-hidden>{WORK_STATUS[status].mark}</span>{WORK_STATUS[status].label}</Badge>;
export const ItemBadge = ({ status }: { status: ItemStatus }) => <Badge cls={ITEM_STATUS[status].cls}>{ITEM_STATUS[status].label}</Badge>;

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cn('rounded-lg border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, desc, actions }: { title: string; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {desc && <p className="mt-1 text-sm text-slate-600">{desc}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} type="button" onClick={() => onChange(t.key)}
          className={cn('-mb-px border-b-2 px-3.5 py-2 text-sm font-medium whitespace-nowrap', value === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cn('w-full rounded-lg bg-white shadow-xl', wide ? 'max-w-4xl' : 'max-w-xl')}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded p-1 text-slate-500 hover:bg-slate-100">✕</button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 rounded-b-lg">{footer}</footer>}
      </div>
    </div>
  );
}

// ── 토스트 ──
type Toast = { id: number; msg: string; kind: 'ok' | 'err' };
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = ++seq.current;
    setList((l) => [...l, { id, msg, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'err' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-80 max-w-[90vw] flex-col gap-2" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} role={t.kind === 'err' ? 'alert' : 'status'} className={cn('pointer-events-auto rounded-md border px-3.5 py-2.5 text-sm shadow-lg', t.kind === 'err' ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900')}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** 연·월 선택 → 현재 경로의 쿼리(year, month)를 바꾼다. */
export function YearMonthNav({ year, month, minYear = 2015, withMonth = true }: { year: number; month?: number; minYear?: number; withMonth?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const maxYear = new Date().getFullYear() + 1;
  const go = (y: number, m?: number) => {
    const q = new URLSearchParams(sp.toString());
    q.set('year', String(y));
    if (withMonth && m) q.set('month', String(m));
    router.push(`${path}?${q.toString()}`);
  };
  const step = (d: number) => {
    if (!withMonth || !month) return go(year + d);
    const t = year * 12 + (month - 1) + d;
    go(Math.floor(t / 12), (t % 12) + 1);
  };
  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);
  return (
    <div className="inline-flex items-center gap-1">
      <Button size="sm" onClick={() => step(-1)} aria-label="이전">‹</Button>
      <Select aria-label="연도" value={year} onChange={(e) => go(Number(e.target.value), month)} className="!h-8 !w-24 text-xs">
        {years.map((y) => <option key={y} value={y}>{y}년</option>)}
      </Select>
      {withMonth && month && (
        <Select aria-label="월" value={month} onChange={(e) => go(year, Number(e.target.value))} className="!h-8 !w-20 text-xs">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
        </Select>
      )}
      <Button size="sm" onClick={() => step(1)} aria-label="다음">›</Button>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{children}</div>;
}

/** 여러 줄 텍스트를 줄바꿈 유지해 표시 */
export function Multiline({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return <span className="text-slate-400">-</span>;
  return <p className={cn('whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800', className)}>{text}</p>;
}
