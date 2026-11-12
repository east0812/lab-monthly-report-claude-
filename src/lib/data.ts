// 여러 화면이 함께 쓰는 조회 함수. 모두 withUser 트랜잭션(tx) 안에서 호출하므로 RLS 가 적용된다.
import type { Tx } from './db';
import type { WorkStatus } from './constants';

export type Product = { id: string; name: string; model: string; family: string; freq_band: string; revision: string; note: string; deleted_at: string | null; version: number; updated_at: string };
export type Category = { id: string; name: string; sort_order: number; is_active: boolean };
export type UserName = { id: string; name: string };

export async function listProducts(tx: Tx, includeDeleted = false): Promise<Product[]> {
  return (await tx`
    select id, name, model, family, freq_band, revision, note, deleted_at, version, updated_at
    from products ${includeDeleted ? tx`` : tx`where deleted_at is null`}
    order by name, model`) as unknown as Product[];
}
export async function listCategories(tx: Tx, includeInactive = false): Promise<Category[]> {
  return (await tx`
    select id, name, sort_order, is_active from work_categories
    ${includeInactive ? tx`` : tx`where is_active`} order by sort_order, name`) as unknown as Category[];
}
/** 활성 직원의 id·이름 (담당자 선택용) */
export async function listUserNames(tx: Tx): Promise<UserName[]> {
  return (await tx`select id, name from active_user_names()`) as unknown as UserName[];
}
export const productLabel = (p: { name: string; model: string } | null | undefined) => (p ? (p.model ? `${p.name} (${p.model})` : p.name) : '');

// ── 모델별 24개월 타임라인 (선택 연도 + 직전 연도) ─────────────
export type TimelineRecord = { id: string; status: WorkStatus; version: number; title: string; progress: number | null };
export type TimelineRow = {
  key: string; product_id: string; product_name: string; model: string;
  user_id: string; user_name: string;
  /** 키: 'YYYY-MM'. 기록이 없는 달은 키 자체가 없다(빈칸). */
  cells: Record<string, TimelineRecord[]>;
};

/**
 * kind='dev' 는 dev_works.status, kind='transfer' 는 transfers.transfer_status 를 월별 상태로 쓴다.
 * 볼 수 있는 범위는 RLS 가 결정한다(본인 / 관리자 / 제출 이후 공유). userId 를 주면 그 담당자만.
 */
export async function loadTimeline(tx: Tx, kind: 'dev' | 'transfer', year: number, opts: { userId?: string } = {}): Promise<TimelineRow[]> {
  const uidFilter = opts.userId ? tx`and t.user_id = ${opts.userId}` : tx``;
  const recs = kind === 'dev'
    ? await tx`
        select t.id, t.user_id, user_name(t.user_id) as user_name, t.year, t.month, t.status, t.version, t.title, t.progress,
               p.id as product_id, p.name as product_name, p.model
        from dev_works t join products p on p.id = t.product_id
        where t.year in (${year - 1}, ${year}) ${uidFilter}
        order by p.name, p.model, user_name, t.year, t.month, t.created_at`
    : await tx`
        select t.id, t.user_id, user_name(t.user_id) as user_name, t.year, t.month, t.transfer_status as status, t.version,
               left(t.content, 60) as title, null::int as progress,
               p.id as product_id, p.name as product_name, p.model
        from transfers t join products p on p.id = t.product_id
        where t.year in (${year - 1}, ${year}) ${uidFilter}
        order by p.name, p.model, user_name, t.year, t.month, t.created_at`;
  const map = new Map<string, TimelineRow>();
  for (const r of recs) {
    const key = `${r.product_id}:${r.user_id}`;
    let row = map.get(key);
    if (!row) {
      row = { key, product_id: r.product_id, product_name: r.product_name, model: r.model, user_id: r.user_id, user_name: r.user_name ?? '', cells: {} };
      map.set(key, row);
    }
    const k = `${r.year}-${String(r.month).padStart(2, '0')}`;
    (row.cells[k] ??= []).push({ id: r.id, status: r.status, version: r.version, title: r.title ?? '', progress: r.progress });
  }
  return [...map.values()];
}
