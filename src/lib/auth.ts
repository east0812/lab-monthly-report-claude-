// 세션 사용자 확인과 권한 검사 (페이지·API 공용)
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from './supabase';
import { withUser, toHttpError, HttpError, type Tx } from './db';
import type { Role } from './constants';

export type SessionUser = { id: string; email: string; name: string; role: Role };

/** 로그인되어 있고 활성 상태인 사용자. 비활성·미등록 계정은 null. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  let uid: string | undefined;
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getClaims();
    uid = data?.claims?.sub as string | undefined;
  } catch {
    return null;
  }
  if (!uid) return null;
  const rows = await withUser(uid, (tx) => tx`select id, email, name, role from profiles where id = ${uid!}`);
  // profiles RLS: 본인 행은 활성 상태일 때만 보인다 → 비활성 계정은 여기서 차단된다.
  return (rows[0] as SessionUser | undefined) ?? null;
});

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect('/login');
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== 'admin') redirect('/dashboard?denied=1');
  return u;
}

// ── API Route 래퍼 ─────────────────────────────────────────
export type ApiCtx = {
  user: SessionUser;
  req: NextRequest;
  params: Record<string, string>;
  /** 사용자 권한(RLS 적용) 트랜잭션 */
  db: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
};

/** 브라우저의 교차 출처 요청(CSRF) 차단 */
export function sameOrigin(req: NextRequest): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function errorResponse(e: unknown): NextResponse {
  const he = toHttpError(e);
  if (he.status >= 500) {
    // 요청 본문(비밀번호 등)은 기록하지 않는다.
    const raw = e as { code?: string; message?: string };
    console.error('[api] 서버 오류:', raw?.code ?? '', raw?.message ?? '');
  }
  return NextResponse.json({ error: he.message }, { status: he.status });
}

type Handler = (c: ApiCtx) => Promise<unknown>;

/** 로그인·활성 상태·역할을 검사한 뒤 핸들러를 실행한다. */
export function route(opts: { admin?: boolean }, fn: Handler) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) throw new HttpError(403, '허용되지 않은 요청입니다.');
      const user = await getSessionUser();
      if (!user) throw new HttpError(401, '로그인이 필요합니다.');
      if (opts.admin && user.role !== 'admin') throw new HttpError(403, '관리자만 사용할 수 있습니다.');
      const out = await fn({ user, req, params: await ctx.params, db: (f) => withUser(user.id, f) });
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {}
  throw new HttpError(400, '요청 형식이 올바르지 않습니다.');
}
