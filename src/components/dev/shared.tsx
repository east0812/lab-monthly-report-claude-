'use client';
// 개발현황·생산이관 화면이 함께 쓰는 부품: 상태 코드가 있는 API 호출, 쿼리 이동, 화면 틀(연월·담당자·탭)
import { useCallback, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, Select, Tabs, YearMonthNav, cn } from '@/components/ui';
import { WORK_STATUS, WORK_STATUS_KEYS, type WorkStatus } from '@/lib/constants';

export type UserOpt = { id: string; name: string };
export type ProductOpt = { id: string; name: string; model: string; revision: string };
export type CategoryOpt = { id: string; name: string };
export type Viewer = { id: string; name: string; isAdmin: boolean };
export type TabKey = 'timeline' | 'detail';

export const LOCK_NOTICE = '제출된 월은 수정할 수 없습니다. (제출 취소 또는 반려 후 수정 가능)';

/** HTTP 상태 코드를 함께 전달하는 오류 (409 충돌 구분용) */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** JSON API 호출. 실패하면 서버 안내 문구와 상태 코드를 담은 ApiError 를 던진다. */
export async function callApi<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.');
  }
  let data: unknown = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401) {
    if (typeof window !== 'undefined' && !location.pathname.startsWith('/login')) location.href = '/login';
    throw new ApiError(401, '로그인이 필요합니다.');
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `요청에 실패했습니다. (${res.status})`);
  return data as T;
}
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : '요청에 실패했습니다.');

/** 현재 경로의 쿼리 일부만 바꿔 이동한다. 값이 null/빈 문자열이면 그 키를 지운다. */
export function useQueryNav() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return useCallback((patch: Record<string, string | number | null | undefined>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') q.delete(k); else q.set(k, String(v));
    }
    const s = q.toString();
    router.push(s ? `${path}?${s}` : path);
  }, [router, path, sp]);
}

export const productText = (p: { name: string; model: string }) => (p.model ? `${p.name} (${p.model})` : p.name);

export function StatusOptions() {
  return <>{WORK_STATUS_KEYS.map((s: WorkStatus) => <option key={s} value={s}>{WORK_STATUS[s].label}</option>)}</>;
}

export function Notice({ kind = 'info', children, action }: { kind?: 'info' | 'warn' | 'error'; children: ReactNode; action?: ReactNode }) {
  const cls = { info: 'border-blue-200 bg-blue-50 text-blue-900', warn: 'border-amber-300 bg-amber-50 text-amber-900', error: 'border-rose-300 bg-rose-50 text-rose-900' }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cn('mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3.5 py-2.5 text-sm', cls)}>
      <span>{children}</span>
      {action}
    </div>
  );
}

/** 연월 선택 · (관리자) 담당자 선택 · 탭. 모두 쿼리 문자열로 이동한다. */
export function MonthPageFrame({ title, desc, year, month, viewer, users, userId, tab, detailLabel, children }: {
  title: string; desc: string; year: number; month: number; viewer: Viewer;
  users: UserOpt[]; userId: string; tab: TabKey; detailLabel: string; children: ReactNode;
}) {
  const nav = useQueryNav();
  return (
    <div>
      <PageHeader title={title} desc={desc} actions={
        <>
          {viewer.isAdmin && (
            <Select aria-label="담당자" value={userId} onChange={(e) => nav({ user: e.target.value, work: null })} className="!h-8 !w-36 text-xs">
              <option value="">담당자: 전체</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          )}
          <YearMonthNav year={year} month={month} />
        </>
      } />
      <Tabs<TabKey>
        tabs={[{ key: 'timeline', label: '모델별 타임라인' }, { key: 'detail', label: detailLabel }]}
        value={tab}
        onChange={(k) => nav({ tab: k === 'detail' ? 'detail' : null, work: null })}
      />
      {children}
    </div>
  );
}
