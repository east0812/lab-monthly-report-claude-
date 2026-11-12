// 전체 검색: 제품·개발현황·생산이관·보고 항목·개발과제·보고서 요약을 한 번에 찾는다.
// 모든 조회는 로그인 사용자 권한(RLS)으로 실행하므로 볼 수 있는 기록만 나온다.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireUser } from '@/lib/auth';
import { withUser, likePattern, type Row } from '@/lib/db';
import { productLabel } from '@/lib/data';
import { REPORT_STATUS, SECTION_LABEL, WORK_STATUS, type ReportStatus, type WorkStatus } from '@/lib/constants';
import { Button, Card, Empty, Input, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

const LIMIT = 50;
const MIN_LEN = 2;

type Hit = {
  id: string;
  kind: string;        // 구분
  product: string;     // 제품/모델
  revision: string;
  user: string;        // 담당자
  ym: string;          // 연월
  texts: string[];     // 검색 대상 본문(앞쪽이 대표 내용)
  href: string;
  tag?: string;        // 상태 등 보조 표시
};
type Group = { key: string; label: string; total: number; hits: Hit[] };

const ymLabel = (y: number | null | undefined, m: number | null | undefined) => (y && m ? `${y}-${String(m).padStart(2, '0')}` : '');
const oneLine = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 검색어가 들어 있는 부분을 앞뒤 문맥과 함께 잘라 낸다. 없으면 대표 내용의 앞부분. */
function excerpt(texts: string[], q: string): string {
  const needle = q.toLowerCase();
  for (const t of texts) {
    const s = oneLine(t);
    const i = s.toLowerCase().indexOf(needle);
    if (i < 0) continue;
    const start = Math.max(0, i - 40);
    const end = Math.min(s.length, i + q.length + 80);
    return `${start > 0 ? '…' : ''}${s.slice(start, end)}${end < s.length ? '…' : ''}`;
  }
  const first = oneLine(texts.find((t) => oneLine(t)) ?? '');
  return first.length > 120 ? `${first.slice(0, 120)}…` : first;
}

/** 검색어 강조. 문자열을 나눠 React 노드로 그리므로 HTML 이 해석되지 않는다. */
function Hl({ text, q }: { text: string; q: string }): ReactNode {
  if (!text) return null;
  const parts = text.split(new RegExp(`(${escapeRe(q)})`, 'gi'));
  return parts.map((p, i) => (i % 2 === 1 ? <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 text-slate-900">{p}</mark> : p));
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const raw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = oneLine(raw).slice(0, 100);
  const ready = q.length >= MIN_LEN;

  let groups: Group[] = [];
  if (ready) {
    const pat = likePattern(q);
    groups = await withUser(me.id, async (tx) => {
      // 여러 열을 줄바꿈으로 이어 붙여 한 번에 비교한다(검색어에는 줄바꿈이 없으므로 열을 넘나드는 일치는 없다).
      const devWorks = await tx`
        select d.id, d.user_id, user_name(d.user_id) as user_name, d.year, d.month, d.title, d.revision, d.status,
               d.work_done, d.test_result, d.issues, d.actions, d.next_plan,
               p.name as product_name, p.model, count(*) over() as total
        from dev_works d join products p on p.id = d.product_id
        where concat_ws(chr(10), d.title, d.revision, d.work_done, d.test_result, d.issues, d.actions, d.next_plan,
                        p.name, p.model, user_name(d.user_id)) ilike ${pat} escape '\\'
        order by d.year desc, d.month desc, d.updated_at desc, d.id
        limit ${LIMIT}`;
      const transfers = await tx`
        select t.id, t.user_id, user_name(t.user_id) as user_name, t.year, t.month, t.transfer_status, t.content, t.plan,
               p.name as product_name, p.model, count(*) over() as total
        from transfers t join products p on p.id = t.product_id
        where concat_ws(chr(10), t.content, t.plan, p.name, p.model, user_name(t.user_id)) ilike ${pat} escape '\\'
        order by t.year desc, t.month desc, t.updated_at desc, t.id
        limit ${LIMIT}`;
      // 다른 직원의 공유 항목(제출 이후 도면·사양서)은 보고서 행을 읽을 수 없어 r.* 이 null 이다.
      const items = await tx`
        select i.id, i.section, i.title, i.revision, i.change_note, i.content, i.item_name, i.vendor, i.note,
               r.id as report_id, r.year, r.month, user_name(r.user_id) as user_name,
               p.id as product_id, p.name as product_name, p.model, count(*) over() as total
        from report_items i
        left join monthly_reports r on r.id = i.report_id
        left join products p on p.id = i.product_id
        where concat_ws(chr(10), i.title, i.revision, i.change_note, i.content, i.item_name, i.vendor, i.note,
                        p.name, p.model, user_name(r.user_id)) ilike ${pat} escape '\\'
        order by r.year desc nulls last, r.month desc nulls last, i.updated_at desc, i.id
        limit ${LIMIT}`;
      const projects = await tx`
        select j.id, j.user_id, user_name(j.user_id) as user_name, j.name, j.goal, j.is_closed,
               p.name as product_name, p.model, lm.report_id, lm.year, lm.month, count(*) over() as total
        from dev_projects j
        left join products p on p.id = j.product_id
        left join lateral (
          select m.report_id, r.year, r.month
          from dev_project_monthly m join monthly_reports r on r.id = m.report_id
          where m.project_id = j.id order by r.year desc, r.month desc limit 1) lm on true
        where concat_ws(chr(10), j.name, j.goal, p.name, p.model, user_name(j.user_id)) ilike ${pat} escape '\\'
        order by j.updated_at desc, j.id
        limit ${LIMIT}`;
      const reports = await tx`
        select r.id, r.year, r.month, r.status, r.summary, user_name(r.user_id) as user_name, count(*) over() as total
        from monthly_reports r
        where concat_ws(chr(10), r.summary, user_name(r.user_id)) ilike ${pat} escape '\\'
        order by r.year desc, r.month desc, r.id
        limit ${LIMIT}`;
      const products = await tx`
        select p.id, p.name, p.model, p.family, p.freq_band, p.revision, p.note, p.deleted_at, count(*) over() as total
        from products p
        where concat_ws(chr(10), p.name, p.model, p.family, p.freq_band, p.revision) ilike ${pat} escape '\\'
        order by (p.deleted_at is not null), p.name, p.model, p.id
        limit ${LIMIT}`;

      const total = (rows: Row[]) => (rows.length ? Number(rows[0].total) : 0);
      const prod = (r: Row) => (r.product_name ? productLabel({ name: r.product_name, model: r.model ?? '' }) : '');
      const out: Group[] = [
        { key: 'dev_works', label: '개발현황', total: total(devWorks), hits: devWorks.map((r) => ({
          id: r.id, kind: '개발현황', product: prod(r), revision: r.revision, user: r.user_name ?? '', ym: ymLabel(r.year, r.month),
          texts: [r.title, r.work_done, r.test_result, r.issues, r.actions, r.next_plan],
          tag: WORK_STATUS[r.status as WorkStatus]?.label,
          href: `/dev-status?year=${r.year}&month=${r.month}&tab=detail${r.user_id !== me.id ? `&user=${r.user_id}` : ''}`,
        })) },
        { key: 'transfers', label: '생산이관', total: total(transfers), hits: transfers.map((r) => ({
          id: r.id, kind: '생산이관', product: prod(r), revision: '', user: r.user_name ?? '', ym: ymLabel(r.year, r.month),
          texts: [r.content, r.plan],
          tag: WORK_STATUS[r.transfer_status as WorkStatus]?.label,
          href: `/transfers?year=${r.year}&month=${r.month}&tab=detail`,
        })) },
        { key: 'report_items', label: '월차보고 항목', total: total(items), hits: items.map((r) => ({
          id: r.id, kind: SECTION_LABEL[r.section] ?? '보고 항목', product: prod(r), revision: r.revision,
          user: r.report_id ? r.user_name ?? '' : '', ym: ymLabel(r.year, r.month),
          texts: [r.title, r.item_name, r.change_note, r.content, r.vendor, r.note],
          tag: r.report_id ? undefined : '공유 문서',
          // 본인·관리자가 읽을 수 있는 보고서는 보고서로, 다른 직원의 공유 문서는 제품 개발이력으로 연결한다.
          href: r.report_id ? `/reports/${r.report_id}` : `/history/products?product=${r.product_id}`,
        })) },
        { key: 'dev_projects', label: '개발과제', total: total(projects), hits: projects.map((r) => ({
          id: r.id, kind: '개발과제', product: prod(r), revision: '', user: r.user_name ?? '', ym: ymLabel(r.year, r.month),
          texts: [r.name, r.goal],
          tag: r.is_closed ? '종료' : undefined,
          href: r.report_id ? `/reports/${r.report_id}` : r.user_id === me.id ? '/reports/write' : '/admin/reports',
        })) },
        { key: 'monthly_reports', label: '월차보고 요약', total: total(reports), hits: reports.map((r) => ({
          id: r.id, kind: '월차보고', product: '', revision: '', user: r.user_name ?? '', ym: ymLabel(r.year, r.month),
          texts: [r.summary],
          tag: REPORT_STATUS[r.status as ReportStatus]?.label,
          href: `/reports/${r.id}`,
        })) },
        { key: 'products', label: '제품', total: total(products), hits: products.map((r) => ({
          id: r.id, kind: '제품', product: productLabel({ name: r.name, model: r.model }), revision: r.revision, user: '', ym: '',
          texts: [[r.family, r.freq_band].filter(Boolean).join(' · '), r.note],
          tag: r.deleted_at ? '삭제됨' : undefined,
          href: `/history/products?product=${r.id}`,
        })) },
      ];
      return out;
    });
  }

  const grand = groups.reduce((s, g) => s + g.total, 0);
  const shown = groups.filter((g) => g.total > 0);

  return (
    <div>
      <PageHeader title="전체 검색" desc="권한 범위 안에서 검색됩니다. 다른 직원의 기록은 제출 이후 공개된 것만 포함됩니다." />
      <form action="/search" method="get" role="search" className="mb-4 flex max-w-2xl gap-2">
        <Input name="q" defaultValue={q} maxLength={100} aria-label="검색어" placeholder="제품명·모델·Revision·담당자·업무 내용" />
        <Button type="submit" variant="primary">검색</Button>
      </form>

      {!ready && (
        <Empty>
          {q ? `검색어를 ${MIN_LEN}자 이상 입력해 주세요.` : '검색어를 입력해 주세요.'}
          <span className="mt-1 block text-xs">제품명, 모델, Revision, 담당자 이름, 업무 내용(수행내용·시험결과·문제점·조치·차월계획 등)에서 찾습니다.</span>
        </Empty>
      )}

      {ready && (
        <div data-search-total={grand}>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-700">
            <span><span className="font-semibold text-slate-900">“{q}”</span> 검색 결과 총 <span className="font-semibold text-blue-700">{grand.toLocaleString()}</span>건</span>
            {shown.map((g) => (
              <a key={g.key} href={`#g-${g.key}`} className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs text-slate-700 hover:border-blue-400 hover:text-blue-700">
                {g.label} {g.total.toLocaleString()}
              </a>
            ))}
          </div>

          {grand === 0 && <Empty>검색 결과가 없습니다. 다른 검색어로 다시 찾아 보세요.</Empty>}

          <div className="space-y-4">
            {shown.map((g) => (
              <div key={g.key} id={`g-${g.key}`} data-group={g.key} data-count={g.total} className="scroll-mt-20">
                <Card pad={false} title={<>{g.label} <span className="ml-1 font-normal text-slate-500">{g.total.toLocaleString()}건{g.total > g.hits.length && ` (최근 ${g.hits.length}건만 표시)`}</span></>}>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] border-collapse text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-left text-xs text-slate-600">
                          <th scope="col" className="w-28 border-b border-slate-200 px-3 py-2 font-semibold">구분</th>
                          <th scope="col" className="w-48 border-b border-slate-200 px-3 py-2 font-semibold">제품/모델</th>
                          <th scope="col" className="w-20 border-b border-slate-200 px-3 py-2 font-semibold">Revision</th>
                          <th scope="col" className="w-20 border-b border-slate-200 px-3 py-2 font-semibold">담당자</th>
                          <th scope="col" className="w-20 border-b border-slate-200 px-3 py-2 font-semibold">연월</th>
                          <th scope="col" className="border-b border-slate-200 px-3 py-2 font-semibold">내용</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.hits.map((h) => (
                          <tr key={h.id} data-hit={`${g.key}:${h.id}`} className="border-b border-slate-100 align-top last:border-b-0 hover:bg-blue-50/50">
                            <td className="px-3 py-2 text-slate-700">
                              {h.kind}
                              {h.tag && <span className="mt-0.5 block text-xs text-slate-500">{h.tag}</span>}
                            </td>
                            <td className="px-3 py-2 text-slate-800"><Hl text={h.product} q={q} />{!h.product && <span className="text-slate-400">-</span>}</td>
                            <td className="px-3 py-2 text-slate-700"><Hl text={h.revision} q={q} />{!h.revision && <span className="text-slate-400">-</span>}</td>
                            <td className="px-3 py-2 text-slate-700"><Hl text={h.user} q={q} />{!h.user && <span className="text-slate-400">-</span>}</td>
                            <td className="px-3 py-2 tabular-nums text-slate-700">{h.ym || <span className="text-slate-400">-</span>}</td>
                            <td className="px-3 py-2">
                              <Link href={h.href} className="block break-words text-slate-800 hover:text-blue-700">
                                <Hl text={excerpt(h.texts, q) || '(내용 없음)'} q={q} />
                                <span className="ml-1.5 whitespace-nowrap text-xs text-blue-700">열기 →</span>
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
