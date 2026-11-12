// 개발현황(dev_works)·생산이관(transfers) API 와 화면이 함께 쓰는 서버 전용 조회·검증 함수.
// 모든 SQL 은 withUser 트랜잭션(tx) 안에서 실행되므로 RLS 가 적용된다.
import { HttpError, type Tx } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { WORK_STATUS_KEYS, kstNow, type WorkStatus } from '@/lib/constants';
import { int, oneOf, optDate, optUuid, str, text, uuid } from '@/lib/validate';

export const CONFLICT_MSG = '다른 화면에서 먼저 수정되었습니다. 새로 고친 뒤 다시 시도해 주세요.';
export const LOCK_MSG = '제출된 월은 수정할 수 없습니다. (제출 취소 또는 반려 후 수정 가능)';
export const NOT_FOUND_MSG = '기록을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.';
export const NOT_OWNER_MSG = '본인이 담당한 기록만 수정할 수 있습니다.';

export type DevWork = {
  id: string; user_id: string; user_name: string; year: number; month: number;
  product_id: string; product_name: string; product_model: string;
  revision: string; category_id: string | null; category_name: string;
  title: string; status: WorkStatus; progress: number;
  work_done: string; test_result: string; issues: string; actions: string; next_plan: string;
  carried_from_id: string | null;
  /** 전월 이월 원본의 정보 (원본이 없거나 삭제되었으면 null) */
  carried_year: number | null; carried_month: number | null; carried_progress: number | null; carried_status: WorkStatus | null;
  version: number; updated_at: string;
};

export type CarryCandidate = {
  id: string; user_id: string; user_name: string; product_name: string; product_model: string;
  revision: string; category_name: string; title: string; status: WorkStatus; progress: number;
  /** 이미 이월된 업무 (다시 이월할 수 없다) */
  carried: boolean;
};

export type Transfer = {
  id: string; user_id: string; user_name: string; year: number; month: number;
  product_id: string; product_name: string; product_model: string;
  dev_status: WorkStatus; transfer_status: WorkStatus;
  planned_date: string | null; completed_date: string | null;
  content: string; plan: string;
  version: number; updated_at: string;
};

// ── 요청 값 해석 ─────────────────────────────────────────────
/** 조회용 연·월: 쿼리에 없으면 한국시간 기준 이번 달 */
export function periodFromQuery(req: { nextUrl: URL }): { year: number; month: number } {
  const sp = req.nextUrl.searchParams;
  const now = kstNow();
  return {
    year: sp.get('year') === null ? now.year : int(sp.get('year'), 2000, 2100, '연도'),
    month: sp.get('month') === null ? now.month : int(sp.get('month'), 1, 12, '월'),
  };
}
export function periodFromBody(body: Record<string, unknown>): { year: number; month: number } {
  return { year: int(body.year, 2000, 2100, '연도'), month: int(body.month, 1, 12, '월') };
}
/** 목록의 담당자 범위: 직원은 항상 본인, 관리자는 지정한 담당자(없으면 전체=null) */
export function listUserId(user: SessionUser, raw: unknown): string | null {
  if (user.role !== 'admin') return user.id;
  return optUuid(raw, '담당자');
}
export function versionOf(v: unknown): number {
  return int(v, 1, 2147483647, '버전');
}

/** 기록의 담당자: 직원은 입력과 무관하게 본인, 관리자는 활성 직원 중에서 지정(없으면 본인) */
export async function resolveOwner(tx: Tx, user: SessionUser, raw: unknown): Promise<string> {
  if (user.role !== 'admin') return user.id;
  const id = optUuid(raw, '담당자') ?? user.id;
  const [ok] = await tx`select 1 as ok from active_user_names() where id = ${id}`;
  if (!ok) throw new HttpError(400, '담당자: 활성 상태인 직원을 선택해 주세요.');
  return id;
}
/** 제품 확인. 삭제된 제품은 이미 그 기록에 연결되어 있을 때만 유지할 수 있다. */
export async function assertProduct(tx: Tx, id: string, currentId: string | null = null): Promise<void> {
  const [p] = await tx`select deleted_at from products where id = ${id}`;
  if (!p) throw new HttpError(400, '제품: 선택한 제품을 찾을 수 없습니다.');
  if (p.deleted_at && id !== currentId) throw new HttpError(400, '제품: 삭제된 제품은 선택할 수 없습니다.');
}
export async function assertCategory(tx: Tx, id: string | null, currentId: string | null = null): Promise<void> {
  if (!id) return;
  const [c] = await tx`select is_active from work_categories where id = ${id}`;
  if (!c) throw new HttpError(400, '분류: 선택한 업무 분류를 찾을 수 없습니다.');
  if (!c.is_active && id !== currentId) throw new HttpError(400, '분류: 사용하지 않는 업무 분류는 선택할 수 없습니다.');
}
/** 직원은 제출된 월에 쓸 수 없다 (DB RLS 와 같은 규칙을 먼저 확인해 안내 문구를 분명히 한다). */
export async function assertWritableMonth(tx: Tx, user: SessionUser, ownerId: string, year: number, month: number): Promise<void> {
  if (user.role === 'admin') return;
  if (ownerId !== user.id) throw new HttpError(403, NOT_OWNER_MSG);
  if (await monthSubmitted(tx, ownerId, year, month)) throw new HttpError(403, LOCK_MSG);
}
export async function monthSubmitted(tx: Tx, uid: string, year: number, month: number): Promise<boolean> {
  const [r] = await tx`select month_submitted(${uid}, ${year}, ${month}) as locked`;
  return !!r?.locked;
}

/**
 * 낙관적 잠금으로 갱신/삭제한 결과 행이 없을 때 원인을 가려 던진다.
 * RLS 아래에서 보이지 않으면 404, 버전이 다르면 409, 그 밖에는(RLS 가 쓰기를 막음) 403.
 */
export async function throwWriteMiss(tx: Tx, table: 'dev_works' | 'transfers', id: string, version: number | null, user: SessionUser): Promise<never> {
  const [cur] = table === 'dev_works'
    ? await tx`select user_id, year, month, version from dev_works where id = ${id}`
    : await tx`select user_id, year, month, version from transfers where id = ${id}`;
  if (!cur) throw new HttpError(404, NOT_FOUND_MSG);
  if (user.role !== 'admin') {
    if (cur.user_id !== user.id) throw new HttpError(403, NOT_OWNER_MSG);
    if (await monthSubmitted(tx, cur.user_id, cur.year, cur.month)) throw new HttpError(403, LOCK_MSG);
  }
  if (version !== null && cur.version !== version) throw new HttpError(409, CONFLICT_MSG);
  throw new HttpError(403, '권한이 없거나 현재 상태에서는 수정할 수 없습니다.');
}

// ── 개발현황 ────────────────────────────────────────────────
const DEV_TEXT_FIELDS = [
  ['work_done', '수행내용'], ['test_result', '시험결과'], ['issues', '문제점'], ['actions', '조치'], ['next_plan', '차월계획'],
] as const;

export type DevWorkInput = {
  product_id: string; revision: string; category_id: string | null; title: string; status: WorkStatus; progress: number;
  work_done: string; test_result: string; issues: string; actions: string; next_plan: string;
};

/** partial=true(PATCH)면 보낸 항목만, false(POST)면 빠진 항목을 기본값으로 채운다. */
export function parseDevWorkInput(body: Record<string, unknown>, partial: boolean): Partial<DevWorkInput> {
  const out: Partial<DevWorkInput> = {};
  const has = (k: string) => body[k] !== undefined;
  if (!partial || has('product_id')) out.product_id = uuid(body.product_id, '제품');
  if (!partial || has('revision')) out.revision = str(body.revision, 100, 'Revision');
  if (!partial || has('category_id')) out.category_id = optUuid(body.category_id, '분류');
  if (!partial || has('title')) out.title = str(body.title, 200, '업무명');
  if (has('status')) out.status = oneOf(body.status, WORK_STATUS_KEYS, '상태');
  else if (!partial) out.status = 'in_progress';
  if (has('progress')) out.progress = int(body.progress, 0, 100, '진행률');
  else if (!partial) out.progress = 0;
  for (const [k, label] of DEV_TEXT_FIELDS) if (!partial || has(k)) out[k] = text(body[k], 5000, label);
  return out;
}

export async function listDevWorks(tx: Tx, f: { year: number; month: number; userId?: string | null; id?: string }): Promise<DevWork[]> {
  return (await tx`
    select w.id, w.user_id, coalesce(user_name(w.user_id), '') as user_name, w.year, w.month,
           w.product_id, p.name as product_name, p.model as product_model,
           w.revision, w.category_id, coalesce(c.name, '') as category_name,
           w.title, w.status, w.progress, w.work_done, w.test_result, w.issues, w.actions, w.next_plan,
           w.carried_from_id, pw.year as carried_year, pw.month as carried_month, pw.progress as carried_progress, pw.status as carried_status,
           w.version, w.updated_at
    from dev_works w
    join products p on p.id = w.product_id
    left join work_categories c on c.id = w.category_id
    left join dev_works pw on pw.id = w.carried_from_id
    where w.year = ${f.year} and w.month = ${f.month}
      ${f.userId ? tx`and w.user_id = ${f.userId}` : tx``}
      ${f.id ? tx`and w.id = ${f.id}` : tx``}
    order by w.created_at, w.id`) as unknown as DevWork[];
}
export async function getDevWork(tx: Tx, id: string): Promise<DevWork | null> {
  const [k] = await tx`select year, month from dev_works where id = ${id}`;
  if (!k) return null;
  return (await listDevWorks(tx, { year: k.year, month: k.month, id }))[0] ?? null;
}

/** 전월(이월 원본 월)의 예정·진행중·보류 업무와 이월 여부 */
export async function listCarryCandidates(tx: Tx, f: { prevYear: number; prevMonth: number; userId?: string | null }): Promise<CarryCandidate[]> {
  return (await tx`
    select w.id, w.user_id, coalesce(user_name(w.user_id), '') as user_name,
           p.name as product_name, p.model as product_model, w.revision, coalesce(c.name, '') as category_name,
           w.title, w.status, w.progress,
           exists (select 1 from dev_works n where n.carried_from_id = w.id) as carried
    from dev_works w
    join products p on p.id = w.product_id
    left join work_categories c on c.id = w.category_id
    where w.year = ${f.prevYear} and w.month = ${f.prevMonth}
      and w.status in ('planned', 'in_progress', 'on_hold')
      ${f.userId ? tx`and w.user_id = ${f.userId}` : tx``}
    order by user_name, p.name, p.model, w.created_at, w.id`) as unknown as CarryCandidate[];
}

// ── 생산이관 ────────────────────────────────────────────────
export type TransferInput = {
  product_id: string; dev_status: WorkStatus; transfer_status: WorkStatus;
  planned_date: string | null; completed_date: string | null; content: string; plan: string;
};

export function parseTransferInput(body: Record<string, unknown>, partial: boolean): Partial<TransferInput> {
  const out: Partial<TransferInput> = {};
  const has = (k: string) => body[k] !== undefined;
  if (!partial || has('product_id')) out.product_id = uuid(body.product_id, '제품');
  if (has('dev_status')) out.dev_status = oneOf(body.dev_status, WORK_STATUS_KEYS, '개발상태');
  else if (!partial) out.dev_status = 'in_progress';
  if (has('transfer_status')) out.transfer_status = oneOf(body.transfer_status, WORK_STATUS_KEYS, '이관상태');
  else if (!partial) out.transfer_status = 'planned';
  if (!partial || has('planned_date')) out.planned_date = optDate(body.planned_date, '예정일');
  if (!partial || has('completed_date')) out.completed_date = optDate(body.completed_date, '완료일');
  if (!partial || has('content')) out.content = text(body.content, 5000, '내용');
  if (!partial || has('plan')) out.plan = text(body.plan, 5000, '계획');
  return out;
}

export async function listTransfers(tx: Tx, f: { year: number; month: number; userId?: string | null; id?: string }): Promise<Transfer[]> {
  return (await tx`
    select t.id, t.user_id, coalesce(user_name(t.user_id), '') as user_name, t.year, t.month,
           t.product_id, p.name as product_name, p.model as product_model,
           t.dev_status, t.transfer_status, t.planned_date, t.completed_date, t.content, t.plan,
           t.version, t.updated_at
    from transfers t
    join products p on p.id = t.product_id
    where t.year = ${f.year} and t.month = ${f.month}
      ${f.userId ? tx`and t.user_id = ${f.userId}` : tx``}
      ${f.id ? tx`and t.id = ${f.id}` : tx``}
    order by p.name, p.model, t.created_at, t.id`) as unknown as Transfer[];
}
export async function getTransfer(tx: Tx, id: string): Promise<Transfer | null> {
  const [k] = await tx`select year, month from transfers where id = ${id}`;
  if (!k) return null;
  return (await listTransfers(tx, { year: k.year, month: k.month, id }))[0] ?? null;
}
