// PostgreSQL 연결. 모든 사용자 요청은 withUser() 로 실행해 RLS 가 적용되게 한다.
import postgres from 'postgres';

export type Tx = postgres.TransactionSql<Record<string, never>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

const g = globalThis as unknown as { __labSql?: postgres.Sql<Record<string, never>> };

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
  return postgres(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 15,
    prepare: false, // Supabase pooler(transaction mode) 호환
    onnotice: () => {},
    types: {
      // date → 'YYYY-MM-DD' 문자열 그대로 (시간대 변환 없이 한국 날짜 유지)
      pgdate: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      pgts: {
        to: 1184, from: [1114, 1184],
        serialize: (x: Date | string) => (x instanceof Date ? x.toISOString() : x),
        parse: (x: string) => new Date(x).toISOString(),
      },
      pgnum: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      pgint8: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
  }) as unknown as postgres.Sql<Record<string, never>>;
}

export function sql() {
  return (g.__labSql ??= connect());
}

/** 로그인 사용자 권한(authenticated 역할 + auth.uid())으로 트랜잭션 실행. RLS 적용. */
export async function withUser<T>(uid: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql().begin(async (tx) => {
    const claims = JSON.stringify({ sub: uid, role: 'authenticated' });
    await tx`select set_config('request.jwt.claims', ${claims}, true), set_config('role', 'authenticated', true)`;
    return fn(tx as unknown as Tx);
  })) as T;
}

/** 비로그인(anon 역할) 실행. 로그인 화면 안내 조회에만 사용. */
export async function withAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('role', 'anon', true)`;
    return fn(tx as unknown as Tx);
  })) as T;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** DB 오류를 사용자에게 보여 줄 수 있는 HTTP 오류로 바꾼다. */
export function toHttpError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  const err = e as { code?: string; message?: string; constraint_name?: string };
  const code = err?.code ?? '';
  if (/^MR4\d\d$/.test(code)) return new HttpError(Number(code.slice(2)), err.message ?? '요청을 처리할 수 없습니다.');
  if (code === '42501') return new HttpError(403, '권한이 없거나 현재 상태에서는 수정할 수 없습니다.');
  if (code === '23505') return new HttpError(409, '이미 같은 자료가 있습니다.');
  if (code === '23503') return new HttpError(409, '다른 자료에서 사용 중이거나 연결된 자료가 없습니다.');
  if (code === '23514' || code === '23502' || code === '22P02' || code === '22003' || code === '22007' || code === '22008')
    return new HttpError(400, '입력 값이 올바르지 않습니다.');
  return new HttpError(500, '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
}

/** ILIKE 검색어 이스케이프 */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}
