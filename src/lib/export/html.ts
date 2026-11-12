// 오프라인 HTML 출력 (회의·발표용 16:9 슬라이드 / 자료 열람용 문서).
// - CSS·그래프(SVG)·동작(JS)을 모두 파일 안에 넣어 인터넷과 로그인 없이 열린다. 외부 주소를 참조하지 않는다.
// - 사용자 입력은 전부 esc() 로 이스케이프한 HTML 텍스트로만 넣는다 (스크립트 영역에는 넣지 않는다).
// - 계정 정보·인증 키·첨부 저장 경로는 포함하지 않는다.
import { ITEM_STATUS, SECTIONS, WORK_STATUS, WORK_STATUS_KEYS, fmtNum, fmtWon, type ItemField, type WorkStatus } from '../constants';
import type { TimelineRow } from '../data';
import { monthlyCompareChart, yearlyChart } from '../charts';
import { statusCounts, type ExportData } from './data';

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c] as string));
}
const br = (v: unknown) => esc(v).replace(/\n/g, '<br>');
const pl = (name: string | null, model: string | null) => (name ? `${name}${model ? ` (${model})` : ''}` : '');
const chip = (s: WorkStatus) => `<span class="chip st-${s}">${WORK_STATUS[s].mark} ${WORK_STATUS[s].label}</span>`;
const ichip = (s: 'done' | 'in_progress' | 'on_hold') => `<span class="chip st-${s}">${ITEM_STATUS[s].label}</span>`;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);
const chunk = <T,>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const qtyText = (q: { unit: string; qty: number }[]) => (q.length ? q.map((x) => `${fmtNum(x.qty, 2)} ${esc(x.unit)}`).join(' · ') : '-');

// ── 공통 조각 ──────────────────────────────────────────────
function timelineTable(rows: TimelineRow[], year: number, hl: string): string {
  const months: { k: string; m: number; y: number }[] = [];
  for (const y of [year - 1, year]) for (let m = 1; m <= 12; m++) months.push({ k: `${y}-${String(m).padStart(2, '0')}`, m, y });
  const head = `<tr><th rowspan="2" class="l w-model">제품 / 모델</th><th rowspan="2" class="l w-owner">담당자</th><th colspan="12" class="yb">${year - 1}년</th><th colspan="12">${year}년</th></tr>`
    + `<tr>${months.map((c) => `<th class="${c.k === hl ? 'hl' : ''}${c.m === 12 && c.y === year - 1 ? ' yb' : ''}">${c.m}</th>`).join('')}</tr>`;
  const body = rows.map((r) => `<tr><th class="l">${esc(r.product_name)} <span class="sub">${esc(r.model)}</span></th><td class="l">${esc(r.user_name)}</td>${months.map((c) => {
    const recs = r.cells[c.k];
    const cls = `${c.k === hl ? 'hl' : ''}${c.m === 12 && c.y === year - 1 ? ' yb' : ''}`;
    if (!recs) return `<td class="${cls}"></td>`;
    const s = recs[0].status;
    return `<td class="${cls}"><span class="tc st-${s}" title="${esc(recs.map((x) => WORK_STATUS[x.status].label + (x.title ? ` · ${x.title}` : '')).join(' / '))}">${WORK_STATUS[s].mark}<i>${WORK_STATUS[s].short}</i>${recs.length > 1 ? `<sup>+${recs.length - 1}</sup>` : ''}</span></td>`;
  }).join('')}</tr>`).join('');
  return `<table class="tl"><thead>${head}</thead><tbody>${body || '<tr><td colspan="26" class="empty">기록이 없습니다.</td></tr>'}</tbody></table>`;
}
const legend = () => `<div class="legend">${WORK_STATUS_KEYS.map((s) => `<span class="tc st-${s}">${WORK_STATUS[s].mark}<i>${WORK_STATUS[s].short}</i></span>`).join('')}<span class="sub">빈칸 = 기록 없음 · 파란 열 = 보고 월</span></div>`;

function table(headers: string[], rows: string[][], cls = ''): string {
  return `<table class="grid ${cls}"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty">내용이 없습니다.</td></tr>`}</tbody></table>`;
}
const tile = (label: string, value: string, sub = '', cls = '') => `<div class="tile ${cls}"><div class="tl-l">${esc(label)}</div><div class="tl-v">${value}</div>${sub ? `<div class="tl-s">${sub}</div>` : ''}</div>`;

function itemCell(i: ExportData['items'][number], k: ItemField): string {
  if (k === 'product_id') return esc(pl(i.product_name, i.product_model));
  if (k === 'category_id') return esc(i.category_name ?? '');
  if (k === 'status') return ichip(i.status);
  if (k === 'quantity') return i.quantity === null ? '' : fmtNum(i.quantity, 2);
  return br(i[k]);
}

function salesBlocks(d: ExportData) {
  const s = d.sales!;
  const cur = s.months[d.month - 1];
  const prevM = d.month === 1 ? s.prevMonths[11] : s.months[d.month - 2];
  const lastY = s.prevMonths[d.month - 1];
  const state = !cur.registered ? '미등록' : cur.zeroConfirmed ? '0원 (확정)' : fmtWon(cur.total);
  const diff = (label: string, a: number | null, b: number | null) => {
    if (a === null || b === null) return tile(label, '-', '비교할 매출이 등록되지 않았습니다.');
    if (b <= 0) return tile(label, '-', `기준 ${fmtWon(b)} (0 이하라 증감률을 계산하지 않음)`);
    const r = ((a - b) / b) * 100;
    return tile(label, `${r >= 0 ? '▲' : '▼'} ${Math.abs(r).toFixed(1)}%`, `기준 ${fmtWon(b)}`);
  };
  const ytd = s.months.slice(0, d.month).filter((m) => m.registered).reduce((a, m) => a + (m.total ?? 0), 0);
  const ytdN = s.months.slice(0, d.month).filter((m) => m.registered).length;
  const tiles = `<div class="tiles">${[
    tile(`${d.month}월 총금액 (부가세 포함)`, esc(state), cur.registered ? `공급가액 ${fmtWon(cur.supply)} · 부가세 ${fmtWon(cur.vat)}` : '이 달의 매출이 아직 등록되지 않았습니다.', 'big'),
    tile('거래 건수', cur.registered ? `${fmtNum(cur.count)}건` : '-'),
    tile('판매수량 (단위별)', cur.registered ? qtyText(cur.qty) : '-'),
    diff('전월 대비', cur.total, prevM?.total ?? null),
    diff('전년 동월 대비', cur.total, lastY?.total ?? null),
    tile(`${d.year}년 누계 (1~${d.month}월)`, ytdN ? fmtWon(ytd) : '미등록', `등록된 ${ytdN}개월 합계`),
  ].join('')}</div>`;
  const monthly = monthlyCompareChart({ year: d.year, current: s.months.map((m) => m.total), previous: s.prevMonths.map((m) => m.total), width: 1120, height: 400 });
  const yearly = yearlyChart({ years: s.years.map((y) => ({ year: y.year, total: y.total, growth: y.growth })), width: 640, height: 470 });
  const stateOf = (m: (typeof s.months)[number]) => (!m.registered ? '<span class="sub">미등록</span>' : fmtWon(m.total));
  const monthTable = table(['월', '건수', '수량(단위별)', `${d.year}년 총금액`, `${d.year - 1}년 총금액`],
    s.months.map((m, i) => [`${m.month}월`, m.registered ? fmtNum(m.count) : '-', m.registered ? qtyText(m.qty) : '-', stateOf(m), stateOf(s.prevMonths[i])]), 'num');
  const yearTable = table(['연도', '총금액 (부가세 포함)', '등록 월수', '직전년도 대비'],
    s.years.map((y) => [`${y.year}년`, y.total === null ? '<span class="sub">미등록</span>' : fmtWon(y.total), `${y.registeredMonths}개월`, y.growth === null ? '-' : `${y.growth >= 0 ? '▲' : '▼'} ${Math.abs(y.growth).toFixed(1)}%`]), 'num');
  return { tiles, monthly, yearly, monthTable, yearTable };
}

// ── 자료 열람용 문서 ────────────────────────────────────────
function docView(d: ExportData): string {
  const c = statusCounts(d);
  const hl = `${d.year}-${String(d.month).padStart(2, '0')}`;
  const secs: { id: string; title: string; html: string }[] = [];
  const add = (title: string, html: string) => secs.push({ id: `sec${secs.length + 1}`, title, html });

  add('월간 요약', `<div class="tiles small">${tile('전체 업무', `${c.total}건`)}${tile('완료', `${c.done}건`)}${tile('진행중', `${c.in_progress}건`)}${tile('보류', `${c.on_hold}건`)}${tile('예정', `${c.planned}건`)}${tile('중단', `${c.stopped}건`)}</div>`
    + (d.summaries.length ? d.summaries.map((s) => `<div class="sum"><div class="sum-h"><b>${esc(s.name)}</b> <span class="sub">${esc(s.status)}${s.submittedAt ? ` · 제출 ${esc(s.submittedAt)}` : ''}</span></div><p>${br(s.summary) || '<span class="sub">요약 없음</span>'}</p></div>`).join('') : '<p class="sub">제출된 보고서가 없습니다.</p>'));
  if (d.submission) add('제출 현황', table(['직원', '상태', '제출일시'], d.submission.map((s) => [esc(s.name), esc(s.status), esc(s.submittedAt)])));
  if (d.sales) {
    const b = salesBlocks(d);
    add('매출 · 판매수량', `${b.tiles}<h3>${d.year}년 월별 매출 (전년 비교)</h3><div class="chart">${b.monthly}</div>${b.monthTable}<h3>최근 5개년 비교</h3><div class="chart narrow">${b.yearly}</div>${b.yearTable}<p class="note">매출은 부가세 포함 총금액 기준입니다. 미등록은 매출 자료가 등록되지 않은 달이며 실제 0원과 구분됩니다. 직전년도 금액이 없거나 0 이하이면 증감률을 계산하지 않습니다.</p>`);
  }
  add('개발현황 · 24개월 타임라인', legend() + timelineTable(d.devTimeline, d.year, hl));
  add(`개발현황 · ${d.month}월 상세`, d.devWorks.length ? d.devWorks.map((w) => `<div class="work"><div class="work-h"><b>${esc(pl(w.product_name, w.product_model))}</b> ${esc(w.revision)} · ${esc(w.title)} <span class="sub">담당 ${esc(w.user_name)}${w.category_name ? ` · ${esc(w.category_name)}` : ''}${w.submitted ? '' : ' · 보고서 미제출'}</span> ${chip(w.status)} <span class="pg">${w.progress}%</span></div>
      <dl>${[['수행내용', w.work_done], ['시험결과', w.test_result], ['문제점', w.issues], ['조치', w.actions], ['차월계획', w.next_plan]].filter((x) => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${br(v)}</dd>`).join('') || '<dd class="sub">상세 내용 없음</dd>'}</dl></div>`).join('') : '<p class="sub">이 달의 개발현황 기록이 없습니다.</p>');
  add('생산이관 · 24개월 타임라인', legend() + timelineTable(d.transferTimeline, d.year, hl));
  add(`생산이관 · ${d.month}월 이관내역`, table(['제품 / 모델', '담당자', '개발상태', '이관상태', '예정일', '완료일', '내용', '계획'],
    d.transfers.map((t) => [esc(pl(t.product_name, t.product_model)), esc(t.user_name), chip(t.dev_status), chip(t.transfer_status), esc(t.planned_date ?? ''), esc(t.completed_date ?? ''), br(t.content), br(t.plan)])));
  for (const sec of SECTIONS) {
    const list = d.items.filter((i) => i.section === sec.key);
    add(sec.label, table([...(d.kind === 'compile' ? ['작성자'] : []), ...sec.fields.map((f) => f.label)], list.map((i) => [...(d.kind === 'compile' ? [esc(i.user_name)] : []), ...sec.fields.map((f) => itemCell(i, f.key))])));
    if (sec.key === 'spec') add('개발과제', d.projects.length ? d.projects.map((p) => `<div class="work"><div class="work-h"><b>${esc(p.name)}</b> <span class="sub">${esc([d.kind === 'compile' ? p.user_name : '', pl(p.product_name, p.product_model), p.category_name ?? '', p.start_date || p.end_date ? `${p.start_date ?? ''} ~ ${p.end_date ?? ''}` : ''].filter(Boolean).join(' · '))}</span> ${ichip(p.status)} <span class="pg">${p.progress}%</span></div>
      <dl>${[['과제 목표', p.goal], ['금월 결과', p.result], ['이슈', p.issue], ['차월 계획', p.next_plan]].filter((x) => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${br(v)}</dd>`).join('')}</dl></div>`).join('') : '<p class="sub">등록된 개발과제가 없습니다.</p>');
  }
  if (d.attachments.length) add('첨부파일 목록', `<ul>${d.attachments.map((a) => `<li>${esc(a)}</li>`).join('')}</ul><p class="note">첨부 원본은 이 파일에 포함되지 않습니다. 사이트에서 내려받아 주세요.</p>`);

  return `<article id="doc"><header class="doc-h"><div class="brand">${esc(d.labName)}</div><h1>${esc(d.title)}</h1><div class="sub">${esc(d.subtitle)} · 출력 ${esc(d.generatedAt)}</div></header>
<nav class="toc" aria-label="목차"><b>목차</b><ol>${secs.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join('')}</ol></nav>
${secs.map((s, i) => `<section id="${s.id}"><h2>${i + 1}. ${esc(s.title)}</h2>${s.html}</section>`).join('\n')}
<footer class="doc-f">${esc(d.labName)} · ${esc(d.title)} · 읽기 전용 출력물</footer></article>`;
}

// ── 회의·발표용 슬라이드 ────────────────────────────────────
type Slide = { title: string; section?: string; body: string; cls?: string };
type CardIn = { head: string; fields: [string, string][] };

/** 짧은 카드는 한 화면에 여러 개(3열×2행), 긴 카드는 넓게 배치한다. */
function packCards(cards: CardIn[]): string[] {
  const slides: string[] = [];
  let cur: string[] = [], rows = [3, 3];
  const flush = () => { if (cur.length) slides.push(`<div class="cards">${cur.join('')}</div>`); cur = []; rows = [3, 3]; };
  for (const c of cards) {
    const len = c.fields.reduce((a, f) => a + f[1].length + 6, 0);
    const span = len <= 170 ? 1 : len <= 400 ? 2 : 3;
    const tall = len > 700;
    const budget = tall ? 1250 : span * 190;
    const ratio = len > budget ? budget / len : 1;
    const body = c.fields.map(([k, v]) => `<div class="cf"><b>${esc(k)}</b> ${br(ratio < 1 ? cut(v, Math.max(30, Math.floor(v.length * ratio))) : v)}</div>`).join('');
    const html = `<div class="card s${span}${tall ? ' tall' : ''}"><div class="ch">${c.head}</div>${body || '<div class="cf sub">상세 내용 없음</div>'}${ratio < 1 ? '<div class="more">… 전체 내용은 자료 원문 참조</div>' : ''}</div>`;
    if (tall) { flush(); slides.push(`<div class="cards">${html}</div>`); continue; }
    let r = rows.findIndex((x) => x >= span);
    if (r < 0) { flush(); r = 0; }
    rows[r] -= span; cur.push(html);
  }
  flush();
  return slides;
}

function buildSlides(d: ExportData): Slide[] {
  const c = statusCounts(d);
  const hl = `${d.year}-${String(d.month).padStart(2, '0')}`;
  const out: Slide[] = [];
  const multi = (title: string, section: string, bodies: string[]) => bodies.forEach((b, i) => out.push({ title: bodies.length > 1 ? `${title} (${i + 1}/${bodies.length})` : title, section: i === 0 ? section : undefined, body: b }));

  // 월간 요약
  const counts = `<div class="tiles">${tile('전체 업무', `${c.total}건`, '', 'big')}${tile('완료', `${c.done}건`)}${tile('진행중', `${c.in_progress}건`)}${tile('보류', `${c.on_hold}건`)}${tile('예정', `${c.planned}건`)}${tile('중단', `${c.stopped}건`)}</div>`;
  if (d.submission) {
    const by: Record<string, number> = {};
    d.submission.forEach((s) => { by[s.status] = (by[s.status] ?? 0) + 1; });
    const done = d.submission.filter((s) => ['제출완료', '관리자 확인', '최종확정'].includes(s.status)).length;
    out.push({ title: '월간 요약', section: '월간 요약', body: `<div class="two"><div><h3>제출 현황 <span class="sub">${done} / ${d.submission.length}명 제출</span></h3>${table(['직원', '상태', '제출일시'], d.submission.slice(0, 11).map((s) => [esc(s.name), esc(s.status), esc(s.submittedAt)]))}${d.submission.length > 11 ? `<p class="sub">외 ${d.submission.length - 11}명 (자료 원문 참조)</p>` : ''}</div>
      <div><h3>업무 상태별 건수</h3>${counts}<p class="sub">${Object.entries(by).map(([k, v]) => `${esc(k)} ${v}명`).join(' · ')}</p></div></div>` });
    multi('직원별 요약', '직원별 요약', packCards(d.summaries.map((s) => ({ head: `<b>${esc(s.name)}</b> <span class="sub">${esc(s.status)}</span>`, fields: [['', s.summary || '요약 없음']] }))));
  } else {
    const s = d.summaries[0];
    out.push({ title: '월간 요약', section: '월간 요약', body: `<div class="two"><div><h3>요약 <span class="sub">${esc(s?.status ?? '')}</span></h3><p class="lead">${br(cut(s?.summary ?? '', 900)) || '<span class="sub">요약 없음</span>'}</p></div><div><h3>업무 상태별 건수</h3>${counts}</div></div>` });
  }
  // 매출
  if (d.sales) {
    const b = salesBlocks(d);
    out.push({ title: `${d.month}월 매출 · 판매수량`, section: '매출 · 판매수량', body: `${b.tiles}<p class="note">부가세 포함 총금액 기준 · 수량은 단위별로 표시 · 미등록과 실제 0원을 구분</p>` });
    out.push({ title: `${d.year}년 월별 매출 (전년 비교)`, body: `<div class="chart">${b.monthly}</div>` });
    out.push({ title: '최근 5개년 매출 비교', body: `<div class="two"><div class="chart">${b.yearly}</div><div>${b.yearTable}<p class="note">직전년도 금액이 없거나 0 이하이면 증감률을 계산하지 않습니다(-).</p></div></div>` });
  }
  // 타임라인
  multi('개발현황 · 24개월', '개발현황', (d.devTimeline.length ? chunk(d.devTimeline, 12) : [[]]).map((rows) => legend() + timelineTable(rows, d.year, hl)));
  multi('생산이관 · 24개월', '생산이관', (d.transferTimeline.length ? chunk(d.transferTimeline, 12) : [[]]).map((rows) => legend() + timelineTable(rows, d.year, hl)));
  // 이슈·조치·차월계획
  const works = d.devWorks.map((w) => ({
    head: `<b>${esc(pl(w.product_name, w.product_model))}</b> ${chip(w.status)} <span class="pg">${w.progress}%</span><div class="sub">${esc(cut(w.title, 40))} · ${esc(w.user_name)}</div>`,
    fields: ([['수행', w.work_done], ['시험', w.test_result], ['이슈', w.issues], ['조치', w.actions], ['차월', w.next_plan]] as [string, string][]).filter((f) => f[1]),
  }));
  if (works.length) multi(`${d.month}월 개발 상세 · 이슈 · 조치 · 차월계획`, '이슈 · 조치 · 차월계획', packCards(works));
  if (d.transfers.length) multi(`${d.month}월 생산이관 내역`, '생산이관 내역', chunk(d.transfers, 7).map((rows) => table(['제품 / 모델', '담당자', '이관상태', '예정일', '완료일', '내용', '계획'],
    rows.map((t) => [esc(pl(t.product_name, t.product_model)), esc(t.user_name), chip(t.transfer_status), esc(t.planned_date ?? ''), esc(t.completed_date ?? ''), br(cut(t.content, 110)), br(cut(t.plan, 110))]))));
  if (d.projects.length) multi('개발과제', '개발과제', packCards(d.projects.map((p) => ({
    head: `<b>${esc(cut(p.name, 44))}</b> ${ichip(p.status)} <span class="pg">${p.progress}%</span><div class="sub">${esc([d.kind === 'compile' ? p.user_name : '', pl(p.product_name, p.product_model)].filter(Boolean).join(' · '))}</div>`,
    fields: ([['결과', p.result], ['이슈', p.issue], ['차월', p.next_plan]] as [string, string][]).filter((f) => f[1]),
  }))));
  for (const sec of SECTIONS) {
    const list = d.items.filter((i) => i.section === sec.key);
    if (!list.length) continue;
    const fields = sec.fields.filter((f) => f.key !== 'note');
    multi(sec.label, sec.label, chunk(list, 8).map((rows) => table([...(d.kind === 'compile' ? ['작성자'] : []), ...fields.map((f) => f.label)],
      rows.map((i) => [...(d.kind === 'compile' ? [esc(i.user_name)] : []), ...fields.map((f) => (f.long ? br(cut(String(i[f.key] ?? ''), 120)) : itemCell(i, f.key)))]))));
  }

  // 표지 + 목차 (앞에 끼워 넣는다)
  const sections = out.map((s, i) => ({ s, n: i + 3 })).filter((x) => x.s.section);
  const cover: Slide = { title: '', cls: 'cover', body: `<div class="cv"><div class="brand">${esc(d.labName)}</div><h1>${esc(d.title)}</h1><div class="cv-sub">${esc(d.subtitle)}</div><div class="cv-date">출력 ${esc(d.generatedAt)}</div></div>` };
  const toc: Slide = { title: '목차', body: `<ol class="toc-list">${sections.map((x) => `<li><a href="#s${x.n}" data-go="${x.n}">${esc(x.s.section)}</a><span>${x.n}</span></li>`).join('')}</ol>` };
  const end: Slide = { title: '', cls: 'cover', body: `<div class="cv"><h1>감사합니다</h1><div class="cv-sub">${esc(d.labName)} · ${esc(d.title)}</div></div>` };
  return [cover, toc, ...out, end];
}

function deckView(d: ExportData): string {
  const slides = buildSlides(d);
  return `<div id="deck"><div id="stage">${slides.map((s, i) => `<section class="slide ${s.cls ?? ''}${i === 0 ? ' on' : ''}" id="s${i + 1}" aria-label="${i + 1}쪽 ${esc(s.title)}">
${s.title ? `<header class="sh"><h2>${esc(s.title)}</h2></header>` : ''}<div class="sb">${s.body}</div>
<footer class="sf"><span>${esc(d.labName)} · ${esc(d.title)}</span><span>${i + 1} / ${slides.length}</span></footer></section>`).join('\n')}</div>
<nav id="tocp" hidden aria-label="목차"><b>목차</b><ol>${slides.map((s, i) => (s.section ? `<li><a href="#s${i + 1}" data-go="${i + 1}">${esc(s.section)} <span>${i + 1}</span></a></li>` : '')).join('')}</ol></nav></div>`;
}

const CSS = `
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;color:#0f172a;background:#eef2f7;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}
a{color:#1d4ed8}.sub{color:#64748b;font-weight:400;font-size:.88em}.note{color:#64748b;font-size:.85em;margin:.6em 0 0}.empty{text-align:center;color:#94a3b8;padding:14px}
.brand{font-weight:700;color:#0f3d8c;letter-spacing:.02em}
.chip{display:inline-block;border-radius:999px;padding:1px 9px;font-size:.82em;font-weight:600;white-space:nowrap;border:1px solid}
.st-planned{background:#f1f5f9;color:#334155;border-color:#cbd5e1}.st-in_progress{background:#dbeafe;color:#1e40af;border-color:#93c5fd}.st-done{background:#d1fae5;color:#065f46;border-color:#6ee7b7}.st-on_hold{background:#fef3c7;color:#92400e;border-color:#fcd34d}.st-stopped{background:#ffe4e6;color:#9f1239;border-color:#fda4af}
.pg{font-weight:700;color:#0f3d8c;font-variant-numeric:tabular-nums}
table{border-collapse:collapse;width:100%}
.grid th,.grid td{border:1px solid #cbd5e1;padding:6px 9px;text-align:left;vertical-align:top;font-size:.92em;word-break:break-word}
.grid th{background:#e8eefb;color:#0f3d8c;white-space:nowrap}.grid.num td:not(:first-child){text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.tl{table-layout:fixed;font-size:11px}.tl th,.tl td{border:1px solid #cbd5e1;padding:2px 1px;text-align:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tl thead th{background:#e8eefb;color:#0f3d8c}.tl .l{text-align:left;padding-left:6px}.tl .w-model{width:19%}.tl .w-owner{width:7%}.tl .yb{border-right:2px solid #64748b}
.tl th.hl{background:#1d4ed8;color:#fff}.tl td.hl{background:#eff6ff}
.tc{display:inline-flex;align-items:center;justify-content:center;gap:1px;border-radius:4px;border:1px solid;padding:0 2px;min-width:92%;font-weight:700;line-height:1.5}.tc i{font-style:normal;font-size:.9em}.tc sup{font-size:.7em}
.legend{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 6px;font-size:11px}.legend .tc{min-width:44px}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.tiles.small{grid-template-columns:repeat(6,1fr)}
.tile{border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:12px 14px}.tile.big{background:#0f3d8c;color:#fff;border-color:#0f3d8c}.tile.big .tl-l,.tile.big .tl-s{color:#dbeafe}
.tl-l{font-size:.8em;color:#64748b;font-weight:600}.tl-v{font-size:1.45em;font-weight:800;font-variant-numeric:tabular-nums;word-break:keep-all}.tl-s{font-size:.8em;color:#64748b}
.chart svg{max-width:100%;height:auto;display:block;margin:0 auto}.chart.narrow{max-width:640px}
/* 문서 */
#doc{max-width:1120px;margin:0 auto;background:#fff;padding:36px 44px 28px;min-height:100vh}
.doc-h{border-bottom:3px solid #0f3d8c;padding-bottom:12px;margin-bottom:16px}.doc-h h1{margin:.1em 0;font-size:1.9em}
.toc{background:#f1f5f9;border-radius:8px;padding:12px 18px;margin-bottom:8px}.toc ol{margin:.3em 0 0;padding-left:1.4em;columns:3;font-size:.92em}
#doc section{margin-top:26px}#doc h2{font-size:1.25em;color:#0f3d8c;border-left:5px solid #2563eb;padding-left:10px;margin:0 0 10px}#doc h3{font-size:1.02em;margin:18px 0 6px}
.sum{border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-top:10px}.sum p{margin:.3em 0 0}
.work{border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:8px;break-inside:avoid}.work dl{display:grid;grid-template-columns:5.5em 1fr;gap:3px 10px;margin:8px 0 0;font-size:.93em}.work dt{color:#64748b;font-weight:600}.work dd{margin:0}
.doc-f{margin-top:30px;border-top:1px solid #cbd5e1;padding-top:8px;color:#94a3b8;font-size:.8em;text-align:center}
/* 도구 막대 */
#bar{position:fixed;left:0;right:0;bottom:0;height:44px;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;gap:6px;padding:0 12px;font-size:13px;z-index:20}
#bar button{font:inherit;color:#e2e8f0;background:#1e293b;border:1px solid #334155;border-radius:6px;padding:5px 11px;cursor:pointer}#bar button:hover{background:#334155}#bar .sp{flex:1}#bar .cnt{min-width:70px;text-align:center;font-variant-numeric:tabular-nums}
body.view-doc{padding-bottom:44px}
/* 슬라이드 */
body.view-deck{background:#0b1220;overflow:hidden}body.view-deck:not(.js){overflow:auto}body.view-deck #doc{display:none}body.view-doc #deck{display:none}
#stage{position:absolute;left:50%;top:0;width:1280px;height:720px;transform-origin:top center}
.slide{position:absolute;inset:0;width:1280px;height:720px;background:#fff;padding:34px 56px 46px;display:none;overflow:hidden;font-size:17px}
.slide.on{display:block}body:not(.js) #stage{position:static;transform:none;margin:0 auto}body:not(.js) .slide{display:block;position:relative;margin:0 auto 16px}
.sh{border-bottom:3px solid #0f3d8c;margin-bottom:16px}.sh h2{margin:0 0 8px;font-size:30px;color:#0f3d8c}
.sb{height:570px;overflow:hidden}.sb h3{margin:0 0 8px;font-size:19px}
.sf{position:absolute;left:56px;right:56px;bottom:14px;display:flex;justify-content:space-between;color:#94a3b8;font-size:12px}
.cover{background:linear-gradient(135deg,#0f3d8c,#1d4ed8);color:#fff}.cover .sf{color:#bfdbfe}.cover .sb{height:620px}
.cv{height:100%;display:flex;flex-direction:column;justify-content:center}.cv .brand{color:#bfdbfe;font-size:24px}.cv h1{font-size:62px;margin:.15em 0}.cv-sub{font-size:26px;color:#dbeafe}.cv-date{margin-top:36px;color:#bfdbfe;font-size:16px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:28px;height:100%}.lead{font-size:19px;white-space:normal}
.slide .tiles{gap:14px}.slide .tile{padding:16px 18px}.slide .tl-v{font-size:27px}.slide .two .tiles{grid-template-columns:repeat(2,1fr)}
.slide .grid th,.slide .grid td{font-size:14px;padding:6px 8px}.slide .tl{font-size:12px}.slide .tl th,.slide .tl td{padding:5px 0}.slide .tl .w-model{width:17%}.slide .tl .w-owner{width:6%}.slide .tl .tc{font-size:10.5px;gap:0;padding:0;min-width:0;width:96%;letter-spacing:-.6px;border-radius:3px}.slide .legend .tc{width:auto;min-width:46px;padding:0 4px;letter-spacing:0;font-size:12px}.slide .legend{font-size:12.5px}
.toc-list{list-style:none;padding:0;margin:8px 0 0;columns:2;column-gap:60px;font-size:22px}.toc-list li{display:flex;justify-content:space-between;border-bottom:1px dotted #94a3b8;padding:9px 2px;break-inside:avoid}.toc-list a{text-decoration:none;color:#0f172a}.toc-list span{color:#64748b}
.cards{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,minmax(0,1fr));grid-auto-flow:row dense;gap:14px;height:100%}
.card{border:1px solid #cbd5e1;border-left:5px solid #2563eb;border-radius:10px;padding:11px 13px;overflow:hidden;font-size:14.5px;line-height:1.45;background:#f8fafc}
.card.s2{grid-column:span 2}.card.s3{grid-column:span 3}.card.tall{grid-row:span 2}
.ch{margin-bottom:6px;font-size:15.5px}.cf{margin-top:3px}.cf b{color:#0f3d8c;margin-right:4px}.more{margin-top:5px;color:#94a3b8;font-size:12px}
#tocp{position:fixed;right:12px;bottom:54px;width:320px;max-height:70vh;overflow:auto;background:#fff;border-radius:10px;padding:14px 16px;box-shadow:0 10px 40px rgba(0,0,0,.4);z-index:30;font-size:14px}
#tocp ol{list-style:none;margin:8px 0 0;padding:0}#tocp a{display:flex;justify-content:space-between;padding:7px 4px;text-decoration:none;color:#0f172a;border-bottom:1px solid #e2e8f0}#tocp a:hover{background:#eff6ff}
/* 인쇄 */
@page{size:A4;margin:14mm 12mm}@page deck{size:1280px 720px;margin:0}
@media print{
 #bar,#tocp{display:none!important}body{background:#fff!important;overflow:visible!important;padding:0!important}
 #doc{max-width:none;padding:0;min-height:0;font-size:10.5pt}#doc section{break-inside:auto}.toc{break-after:avoid}.tl{font-size:7.5pt}.tc i{display:none}.legend .tc i{display:inline}.grid th,.grid td{font-size:9pt;padding:4px 6px}
 .tiles.small{grid-template-columns:repeat(6,1fr)}.tl-v{font-size:1.15em}
 body.view-deck #stage{position:static!important;transform:none!important;width:1280px;height:auto}
 body.view-deck .slide{display:block!important;position:relative!important;page:deck;break-after:page;page-break-after:always}
}`;

const JS = `(function(){
var b=document.body,slides=[].slice.call(document.querySelectorAll('.slide')),stage=document.getElementById('stage'),cnt=document.getElementById('cnt'),tocp=document.getElementById('tocp'),i=0;
function $(id){return document.getElementById(id)}
function on(id,fn){var e=$(id);if(e)e.addEventListener('click',fn)}
function doPrint(){window.print()}
on('b-print',doPrint);
if(b.hasAttribute('data-autoprint'))window.addEventListener('load',function(){setTimeout(doPrint,400)});
if(!slides.length)return;
b.classList.add('js');
function fit(){var s=Math.min(window.innerWidth/1280,(window.innerHeight-44)/720);stage.style.transform='translateX(-50%) scale('+s+')'}
function show(n){i=Math.max(0,Math.min(slides.length-1,n));for(var k=0;k<slides.length;k++)slides[k].classList.toggle('on',k===i);if(cnt)cnt.textContent=(i+1)+' / '+slides.length;try{history.replaceState(null,'','#s'+(i+1))}catch(e){}}
function view(v){b.classList.toggle('view-deck',v==='deck');b.classList.toggle('view-doc',v!=='deck');var t=$('b-view');if(t)t.textContent=v==='deck'?'자료 원문':'슬라이드';if(tocp)tocp.hidden=true;if(v==='deck'){fit();window.scrollTo(0,0)}}
function isDeck(){return b.classList.contains('view-deck')}
function full(){var d=document;if(d.fullscreenElement){d.exitFullscreen()}else if(d.documentElement.requestFullscreen){d.documentElement.requestFullscreen()}}
on('b-prev',function(){show(i-1)});on('b-next',function(){show(i+1)});on('b-full',full);
on('b-toc',function(){if(!isDeck())view('deck');tocp.hidden=!tocp.hidden});
on('b-view',function(){view(isDeck()?'doc':'deck')});
document.addEventListener('click',function(e){var a=e.target.closest?e.target.closest('[data-go]'):null;if(a){e.preventDefault();if(!isDeck())view('deck');show(parseInt(a.getAttribute('data-go'),10)-1);tocp.hidden=true}});
document.addEventListener('keydown',function(e){
 if(e.ctrlKey||e.metaKey||e.altKey)return;var k=e.key;
 if(k==='d'||k==='D'){view(isDeck()?'doc':'deck');return}
 if(k==='p'||k==='P'){doPrint();return}
 if(!isDeck())return;
 if(k==='ArrowRight'||k==='ArrowDown'||k==='PageDown'||k===' '||k==='Enter'){e.preventDefault();show(i+1)}
 else if(k==='ArrowLeft'||k==='ArrowUp'||k==='PageUp'||k==='Backspace'){e.preventDefault();show(i-1)}
 else if(k==='Home'){show(0)}else if(k==='End'){show(slides.length-1)}
 else if(k==='f'||k==='F'){full()}else if(k==='t'||k==='T'){tocp.hidden=!tocp.hidden}else if(k==='Escape'){tocp.hidden=true}
});
window.addEventListener('resize',fit);
var m=/^#s(\\d+)$/.exec(location.hash);fit();show(m?parseInt(m[1],10)-1:0);
})();`;

export function renderHtml(d: ExportData, mode: 'slides' | 'doc', opts: { autoPrint?: boolean } = {}): string {
  const deck = mode === 'slides';
  const bar = `<div id="bar" role="toolbar" aria-label="보기 도구">${deck
    ? '<button id="b-prev" type="button" title="이전 (←)">◀ 이전</button><span class="cnt" id="cnt"></span><button id="b-next" type="button" title="다음 (→)">다음 ▶</button><button id="b-toc" type="button" title="목차 (T)">목차</button><span class="sp"></span><span class="sub" style="color:#94a3b8">방향키 이동 · F 전체화면 · D 원문 전환</span><button id="b-view" type="button" title="자료 원문 전환 (D)">자료 원문</button><button id="b-full" type="button" title="전체화면 (F)">전체화면</button>'
    : `<span>${esc(d.labName)} · ${esc(d.title)}</span><span class="sp"></span>`}<button id="b-print" type="button" title="인쇄 / PDF 저장 (P)">인쇄 / PDF</button></div>`;
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(d.labName)} ${esc(d.title)} - ${esc(d.subtitle)}</title>
<style>${CSS}</style></head>
<body class="${deck ? 'view-deck' : 'view-doc'}"${opts.autoPrint ? ' data-autoprint' : ''}>
${deck ? deckView(d) : ''}
${docView(d)}
${bar}
<script>${JS}</script>
</body></html>`;
}
