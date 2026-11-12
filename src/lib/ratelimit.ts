// 간단한 메모리 기반 시도 제한 (서버 1대 기준). Supabase 자체 rate limit 과 함께 동작한다.
const hits = new Map<string, { n: number; reset: number }>();

export function tooMany(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return false;
  }
  h.n += 1;
  return h.n > limit;
}
export function clearHits(key: string) {
  hits.delete(key);
}

export function emailResetEnabled(): boolean {
  return process.env.PASSWORD_RESET_EMAIL_ENABLED === 'true' && !!process.env.APP_BASE_URL;
}
