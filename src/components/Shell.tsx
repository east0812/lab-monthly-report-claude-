'use client';
// 공통 화면 틀: 왼쪽 사이드바 + 상단(전체 검색·알림·추가 메뉴)
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, cn, ToastProvider } from './ui';
import { fmtDateTime, type Role } from '@/lib/constants';

type Me = { id: string; name: string; email: string; role: Role };
type Notice = { id: string; title: string; body: string; link: string; is_read: boolean; created_at: string };

const NAV: { href: string; label: string; icon: string; admin?: boolean }[] = [
  { href: '/dashboard', label: '대시보드', icon: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  { href: '/reports/write', label: '월차보고 작성', icon: 'M4 20h4l11-11-4-4L4 16v4zM14 6l4 4' },
  { href: '/reports', label: '월차보고 내역', icon: 'M6 3h9l4 4v14H6zM9 9h7M9 13h7M9 17h5' },
  { href: '/dev-status', label: '개발현황', icon: 'M4 19h16M7 16V9M12 16V5M17 16v-4' },
  { href: '/transfers', label: '생산이관', icon: 'M3 8h13l-3-3M21 16H8l3 3' },
  { href: '/admin/overview', label: '연구소 현황', icon: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z', admin: true },
  { href: '/admin/reports', label: '월차보고 관리', icon: 'M5 4h14v16H5zM8 9l2 2 4-4M8 15h8', admin: true },
  { href: '/admin/sales', label: '연구소 매출현황', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2', admin: true },
];
const MORE: { href: string; label: string; admin?: boolean }[] = [
  { href: '/history/my', label: '내 업무 이력' },
  { href: '/history/products', label: '제품 개발이력' },
  { href: '/me', label: '내 정보' },
  { href: '/admin/users', label: '직원 관리', admin: true },
  { href: '/admin/products', label: '제품 관리', admin: true },
  { href: '/admin/categories', label: '업무분류 관리', admin: true },
  { href: '/admin/settings', label: '시스템 설정', admin: true },
];

function Icon({ d }: { d: string }) {
  return <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onOut(); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [ref, onOut, active]);
}

export function Shell({ me, labName, unread, children }: { me: Me; labName: string; unread: number; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const isAdmin = me.role === 'admin';
  const [q, setQ] = useState('');
  const [openN, setOpenN] = useState(false);
  const [openM, setOpenM] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [count, setCount] = useState(unread);
  const nRef = useRef<HTMLDivElement>(null);
  const mRef = useRef<HTMLDivElement>(null);
  useOutside(nRef, () => setOpenN(false), openN);
  useOutside(mRef, () => setOpenM(false), openM);
  useEffect(() => setCount(unread), [unread]);
  useEffect(() => { setNavOpen(false); setOpenM(false); setOpenN(false); }, [path]);

  const active = (href: string) => (href === '/reports' ? path === '/reports' || (/^\/reports\/[^/]+$/.test(path) && path !== '/reports/write') : path === href || path.startsWith(href + '/'));

  const loadNotices = async () => {
    try { const r = await api<{ items: Notice[]; unread: number }>('GET', '/api/notifications'); setNotices(r.items); setCount(r.unread); } catch { setNotices([]); }
  };
  const openNotice = async (n: Notice) => {
    setOpenN(false);
    if (!n.is_read) { try { await api('POST', '/api/notifications', { action: 'read', id: n.id }); setCount((c) => Math.max(0, c - 1)); } catch {} }
    if (n.link) router.push(n.link);
  };
  const readAll = async () => {
    try { await api('POST', '/api/notifications', { action: 'read_all' }); setCount(0); setNotices((l) => (l ?? []).map((x) => ({ ...x, is_read: true }))); } catch {}
  };
  const logout = async () => {
    try { await api('POST', '/api/auth/logout'); } catch {}
    location.href = '/login';
  };

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-slate-50 print:block print:bg-white">
        <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-blue-900/20 bg-[#0f3d8c] text-blue-50 transition-transform print:hidden lg:translate-x-0', navOpen ? 'translate-x-0' : '-translate-x-full')}>
          <Link href="/dashboard" className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-white/15 text-sm font-bold">月</span>
            <span className="truncate text-sm font-semibold">{labName || '연구소'} 월차보고</span>
          </Link>
          <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="주 메뉴">
            {NAV.filter((n) => !n.admin).map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined}
                className={cn('mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm', active(n.href) ? 'bg-white text-blue-900 font-semibold' : 'text-blue-100 hover:bg-white/10')}>
                <Icon d={n.icon} />{n.label}
              </Link>
            ))}
            {isAdmin && (
              <>
                <div className="mb-1 mt-4 px-3 text-[11px] font-semibold tracking-wide text-blue-200/80">관리자</div>
                {NAV.filter((n) => n.admin).map((n) => (
                  <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined}
                    className={cn('mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm', active(n.href) ? 'bg-white text-blue-900 font-semibold' : 'text-blue-100 hover:bg-white/10')}>
                    <Icon d={n.icon} />{n.label}
                  </Link>
                ))}
              </>
            )}
          </nav>
          <div className="border-t border-white/10 px-4 py-3 text-xs text-blue-200">
            <div className="truncate font-medium text-white">{me.name}</div>
            <div className="truncate">{isAdmin ? '관리자' : '직원'} · {me.email}</div>
          </div>
        </aside>
        {navOpen && <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setNavOpen(false)} />}

        <div className="flex min-w-0 flex-1 flex-col lg:pl-56 print:pl-0">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 print:hidden">
            <button type="button" className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="메뉴 열기" onClick={() => setNavOpen(true)}>
              <Icon d="M4 6h16M4 12h16M4 18h16" />
            </button>
            <form role="search" className="relative min-w-0 max-w-xl flex-1" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}>
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"><Icon d="M11 4a7 7 0 105 12l4 4M16 16" /></span>
              <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="전체 업무 검색" placeholder="전체 업무 검색 (제품명·모델·Revision·담당자·업무 내용)"
                className="h-9 w-full rounded-md border border-slate-300 bg-slate-50 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </form>
            <div className="ml-auto flex items-center gap-1">
              <div className="relative" ref={nRef}>
                <button type="button" aria-label={`알림${count ? ` (읽지 않음 ${count}건)` : ''}`} aria-expanded={openN} onClick={() => { const o = !openN; setOpenN(o); setOpenM(false); if (o) loadNotices(); }}
                  className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100">
                  <Icon d="M6 16V11a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0" />
                  {count > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-rose-600 px-1 text-center text-[10px] font-bold leading-4 text-white">{count > 99 ? '99+' : count}</span>}
                </button>
                {openN && (
                  <div className="absolute right-0 mt-1 w-80 max-w-[90vw] rounded-md border border-slate-200 bg-white shadow-lg">
                    <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                      <span className="text-sm font-semibold">알림</span>
                      <button type="button" className="text-xs text-blue-700 hover:underline" onClick={readAll}>모두 읽음</button>
                    </div>
                    <ul className="max-h-96 overflow-y-auto">
                      {notices === null && <li className="px-3 py-6 text-center text-sm text-slate-500">불러오는 중…</li>}
                      {notices?.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">알림이 없습니다.</li>}
                      {notices?.map((n) => (
                        <li key={n.id}>
                          <button type="button" onClick={() => openNotice(n)} className={cn('block w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50', !n.is_read && 'bg-blue-50/60')}>
                            <div className="flex items-start gap-2">
                              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.is_read ? 'bg-transparent' : 'bg-blue-600')} />
                              <div className="min-w-0">
                                <div className="text-sm text-slate-800">{n.title}</div>
                                {n.body && <div className="mt-0.5 truncate text-xs text-slate-600">{n.body}</div>}
                                <div className="mt-0.5 text-[11px] text-slate-400">{fmtDateTime(n.created_at)}</div>
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="relative" ref={mRef}>
                <button type="button" aria-label="추가 메뉴" aria-expanded={openM} onClick={() => { setOpenM(!openM); setOpenN(false); }}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
                  <span className="hidden max-w-28 truncate sm:inline">{me.name}</span>
                  <Icon d="M5 12h.01M12 12h.01M19 12h.01" />
                </button>
                {openM && (
                  <div className="absolute right-0 mt-1 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                    {MORE.filter((m) => !m.admin).map((m) => <Link key={m.href} href={m.href} className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">{m.label}</Link>)}
                    {isAdmin && <div className="my-1 border-t border-slate-200" />}
                    {isAdmin && MORE.filter((m) => m.admin).map((m) => <Link key={m.href} href={m.href} className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">{m.label}</Link>)}
                    <div className="my-1 border-t border-slate-200" />
                    <button type="button" onClick={logout} className="block w-full px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50">로그아웃</button>
                  </div>
                )}
              </div>
            </div>
          </header>
          <main className="min-w-0 flex-1 p-4 sm:p-6 print:p-0">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
