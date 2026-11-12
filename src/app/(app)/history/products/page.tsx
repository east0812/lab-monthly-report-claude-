// 제품 개발이력: 제품 하나의 개발 업무·생산이관·문서(도면/사양서)·Revision 변경을 시간순으로 본다.
// 조회는 로그인 사용자 권한(RLS)으로만 실행한다 → 직원은 본인 기록 + 제출 이후 공개된 기록, 관리자는 전체.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireUser } from '@/lib/auth';
import { withUser, type Row } from '@/lib/db';
import { listProducts, productLabel, type Product } from '@/lib/data';
import { SECTION_LABEL, fmtDateTime, type ItemStatus, type WorkStatus } from '@/lib/constants';
import { Badge, Card, Empty, ItemBadge, Multiline, PageHeader, WorkBadge } from '@/components/ui';
import { ProductPicker } from '@/components/history/ProductPicker';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Entry = { key: string; year: number; month: number; order: number; node: ReactNode };

const KIND_CLS = {
  dev: 'bg-blue-100 text-blue-800 ring-blue-300',
  transfer: 'bg-violet-100 text-violet-800 ring-violet-300',
  doc: 'bg-amber-100 text-amber-900 ring-amber-300',
  revision: 'bg-slate-100 text-slate-700 ring-slate-300',
};

function Detail({ label, text }: { label: string; text: string | null | undefined }) {
  if (!text || !text.trim()) return null;
  return (
    <div className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[5.5rem_1fr]">
      <dt className="text-xs font-medium leading-relaxed text-slate-500 sm:pt-0.5">{label}</dt>
      <dd><Multiline text={text} /></dd>
    </div>
  );
}

function EntryCard({ kind, kindLabel, title, meta, href, children }: { kind: keyof typeof KIND_CLS; kindLabel: string; title: ReactNode; meta: ReactNode; href?: string; children?: ReactNode }) {
  return (
    <li className="rounded-md border border-slate-200 bg-white px-4 py-3" data-entry={kind}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <Badge cls={KIND_CLS[kind]}>{kindLabel}</Badge>
        <span className="min-w-0 break-words text-sm font-semibold text-slate-900">{title}</span>
        {meta}
        {href && <Link href={href} className="ml-auto whitespace-nowrap text-xs text-blue-700 hover:underline">열기 →</Link>}
      </div>
      {children && <dl className="mt-2.5 space-y-1.5">{children}</dl>}
    </li>
  );
}

const Meta = ({ children }: { children: ReactNode }) => <span className="text-xs text-slate-600">{children}</span>;

export default async function ProductHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const raw = Array.isArray(sp.product) ? sp.product[0] : sp.product;
  const productId = raw && UUID.test(raw) ? raw.toLowerCase() : null;

  const data = await withUser(me.id, async (tx) => {
    const products = await listProducts(tx, true); // 삭제된 제품도 이력은 볼 수 있다
    const product = productId ? products.find((p) => p.id === productId) ?? null : null;
    if (!product) return { products, product, devWorks: [] as Row[], transfers: [] as Row[], docs: [] as Row[], revisions: [] as Row[] };
    const devWorks = await tx`
      select d.id, d.user_id, user_name(d.user_id) as user_name, d.year, d.month, d.title, d.revision, d.status, d.progress,
             d.work_done, d.test_result, d.issues, d.actions, d.next_plan, c.name as category
      from dev_works d left join work_categories c on c.id = d.category_id
      where d.product_id = ${product.id}
      order by d.year desc, d.month desc, d.created_at, d.id`;
    const transfers = await tx`
      select t.id, t.user_id, user_name(t.user_id) as user_name, t.year, t.month, t.dev_status, t.transfer_status,
             t.planned_date, t.completed_date, t.content, t.plan
      from transfers t
      where t.product_id = ${product.id}
      order by t.year desc, t.month desc, t.created_at, t.id`;
    // 다른 직원의 공유 문서는 보고서 행을 읽을 수 없어(r.* = null) 보고 연월 대신 항목 등록일을 기준으로 놓는다.
    const docs = await tx`
      select i.id, i.section, i.title, i.revision, i.change_note, i.status, i.note,
             r.id as report_id, user_name(r.user_id) as user_name,
             coalesce(r.year, extract(year from i.created_at at time zone 'Asia/Seoul')::int) as year,
             coalesce(r.month, extract(month from i.created_at at time zone 'Asia/Seoul')::int) as month
      from report_items i left join monthly_reports r on r.id = i.report_id
      where i.product_id = ${product.id} and i.section in ('sm_drawing', 'spec')
      order by i.created_at, i.id`;
    const revisions = await tx`
      select r.id, r.revision, r.prev_revision, user_name(r.changed_by) as user_name, r.changed_at,
             extract(year from r.changed_at at time zone 'Asia/Seoul')::int as year,
             extract(month from r.changed_at at time zone 'Asia/Seoul')::int as month
      from product_revisions r
      where r.product_id = ${product.id}
      order by r.changed_at desc, r.id`;
    return { products, product, devWorks, transfers, docs, revisions };
  });

  const { product } = data;
  const isAdmin = me.role === 'admin';
  const scopeNote = isAdmin
    ? '관리자는 모든 직원의 기록을 볼 수 있습니다.'
    : '공개 범위: 내가 작성한 기록과, 다른 직원이 월차보고를 제출한 달의 기록(개발 업무·생산이관·도면·사양서)만 표시됩니다. 작성 중이거나 반려된 달의 기록은 보이지 않습니다.';

  const entries: Entry[] = [];
  for (const r of data.revisions) {
    entries.push({ key: `rev:${r.id}`, year: r.year, month: r.month, order: 0, node: (
      <EntryCard kind="revision" kindLabel="Revision 변경"
        title={r.prev_revision === null ? <>최초 등록: {r.revision || '(없음)'}</> : <>{r.prev_revision || '(없음)'} → {r.revision || '(없음)'}</>}
        meta={<Meta>{r.user_name ? `변경자 ${r.user_name} · ` : ''}{fmtDateTime(r.changed_at)}</Meta>} />
    ) });
  }
  for (const r of data.devWorks) {
    entries.push({ key: `dev:${r.id}`, year: r.year, month: r.month, order: 1, node: (
      <EntryCard kind="dev" kindLabel="개발 업무" title={r.title || '(제목 없음)'}
        href={`/dev-status?year=${r.year}&month=${r.month}&tab=detail${r.user_id !== me.id ? `&user=${r.user_id}` : ''}`}
        meta={<>
          <WorkBadge status={r.status as WorkStatus} />
          <Meta>진행률 {r.progress}%</Meta>
          <Meta>담당자 {r.user_name || '-'}</Meta>
          {r.revision && <Meta>Revision {r.revision}</Meta>}
          {r.category && <Meta>{r.category}</Meta>}
        </>}>
        <Detail label="수행내용" text={r.work_done} />
        <Detail label="시험결과" text={r.test_result} />
        <Detail label="문제점" text={r.issues} />
        <Detail label="조치" text={r.actions} />
        <Detail label="차월계획" text={r.next_plan} />
      </EntryCard>
    ) });
  }
  for (const r of data.transfers) {
    entries.push({ key: `tr:${r.id}`, year: r.year, month: r.month, order: 2, node: (
      <EntryCard kind="transfer" kindLabel="생산이관" title="생산이관 진행"
        href={`/transfers?year=${r.year}&month=${r.month}&tab=detail`}
        meta={<>
          <span className="inline-flex items-center gap-1 text-xs text-slate-600">이관 <WorkBadge status={r.transfer_status as WorkStatus} /></span>
          <span className="inline-flex items-center gap-1 text-xs text-slate-600">개발 <WorkBadge status={r.dev_status as WorkStatus} /></span>
          <Meta>담당자 {r.user_name || '-'}</Meta>
          {r.planned_date && <Meta>이관 예정일 {r.planned_date}</Meta>}
          {r.completed_date && <Meta>이관 완료일 {r.completed_date}</Meta>}
        </>}>
        <Detail label="진행 내용" text={r.content} />
        <Detail label="향후 계획" text={r.plan} />
      </EntryCard>
    ) });
  }
  for (const r of data.docs) {
    entries.push({ key: `doc:${r.id}`, year: r.year, month: r.month, order: 3, node: (
      <EntryCard kind="doc" kindLabel={SECTION_LABEL[r.section] ?? '문서'} title={r.title || '(문서명 없음)'}
        href={r.report_id ? `/reports/${r.report_id}` : undefined}
        meta={<>
          <ItemBadge status={r.status as ItemStatus} />
          {r.revision && <Meta>Revision {r.revision}</Meta>}
          {r.report_id
            ? <Meta>담당자 {r.user_name || '-'}</Meta>
            : <span className="text-xs text-slate-500" title="다른 직원이 제출한 보고서의 문서입니다. 보고 연월은 공개되지 않아 등록일 기준으로 표시합니다.">공유 문서 · 등록일 기준</span>}
        </>}>
        <Detail label="변경 내용" text={r.change_note} />
        <Detail label="비고" text={r.note} />
      </EntryCard>
    ) });
  }
  entries.sort((a, b) => b.year - a.year || b.month - a.month || a.order - b.order);
  const months: { ym: string; label: string; items: Entry[] }[] = [];
  for (const e of entries) {
    const ym = `${e.year}-${String(e.month).padStart(2, '0')}`;
    const last = months[months.length - 1];
    if (last && last.ym === ym) last.items.push(e);
    else months.push({ ym, label: `${e.year}년 ${e.month}월`, items: [e] });
  }

  const picker = data.products.map((p: Product) => ({ id: p.id, name: p.name, model: p.model, family: p.family, deleted: !!p.deleted_at }));
  const counts: [string, number][] = [['개발 업무', data.devWorks.length], ['생산이관', data.transfers.length], ['문서', data.docs.length], ['Revision 변경', data.revisions.length]];

  return (
    <div>
      <PageHeader title="제품 개발이력" desc="제품을 고르면 개발 업무·생산이관·도면/사양서·Revision 변경을 최근 순으로 이어서 볼 수 있습니다." />
      <div className="grid items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card title="제품 선택" className="lg:sticky lg:top-[4.5rem]">
          <ProductPicker products={picker} selectedId={product?.id ?? null} />
        </Card>

        <div className="min-w-0 space-y-4">
          {!product && (
            <Empty>
              {productId || raw ? '제품을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.' : '제품을 선택하면 개발이력이 표시됩니다.'}
            </Empty>
          )}

          {product && (
            <>
              <Card title={<>기본정보 {product.deleted_at && <span className="ml-1.5 align-middle"><Badge cls="bg-rose-100 text-rose-800 ring-rose-300">삭제됨</Badge></span>}</>}>
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-5" data-product={product.id}>
                  <div><dt className="text-xs text-slate-500">제품명</dt><dd className="mt-0.5 font-semibold text-slate-900">{product.name}</dd></div>
                  <div><dt className="text-xs text-slate-500">모델</dt><dd className="mt-0.5 text-slate-900">{product.model || '-'}</dd></div>
                  <div><dt className="text-xs text-slate-500">제품군</dt><dd className="mt-0.5 text-slate-900">{product.family || '-'}</dd></div>
                  <div><dt className="text-xs text-slate-500">주파수대역</dt><dd className="mt-0.5 text-slate-900">{product.freq_band || '-'}</dd></div>
                  <div><dt className="text-xs text-slate-500">현재 Revision</dt><dd className="mt-0.5 font-semibold text-blue-800">{product.revision || '-'}</dd></div>
                </dl>
                {product.deleted_at && <p className="mt-3 text-xs text-slate-500">삭제된 제품입니다. 새 기록에는 선택할 수 없지만 지난 이력은 그대로 보존됩니다.</p>}
              </Card>

              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                {counts.map(([label, n]) => (
                  <span key={label} className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5">{label} <span className="font-semibold text-slate-900">{n}</span></span>
                ))}
              </div>
              <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-900">{scopeNote}</p>

              {months.length === 0 && <Empty>{productLabel(product)} 제품에 대해 볼 수 있는 이력이 아직 없습니다.</Empty>}

              {months.map((m) => (
                <section key={m.ym} aria-label={m.label} data-ym={m.ym}>
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-600" aria-hidden />
                    {m.label}
                    <span className="text-xs font-normal text-slate-500">{m.items.length}건</span>
                  </h2>
                  <ul className="ml-1 space-y-2 border-l-2 border-blue-100 pl-4">
                    {m.items.map((e) => <FragmentNode key={e.key}>{e.node}</FragmentNode>)}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FragmentNode({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
