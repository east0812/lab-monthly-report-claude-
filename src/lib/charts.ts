// 그래프: 외부 글꼴·CSS·JS·이미지 없이 스스로 완결된 inline SVG 문자열을 만든다.
// 앱 화면과 오프라인 HTML 내보내기 양쪽에 그대로 넣어 쓴다. 모든 글자는 escapeHtml 로 이스케이프한다.
// (이 파일은 다른 모듈을 import 하지 않는다 — 어디서든 단독으로 쓸 수 있게.)

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── 색·글꼴 (밝은 배경 기준. 계열색은 색각이상 구분 검증을 통과한 조합) ──
const C = {
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#6f6e69',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  surface: '#ffffff',
  s1: '#2a78d6', // 선택 연도 (파랑)
  s2: '#eb6834', // 전년 (주황)
  up: '#006300',
  down: '#b3261e',
};
const FONT = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',system-ui,-apple-system,'Segoe UI',sans-serif";

const esc = escapeHtml;
const r1 = (n: number) => String(Math.round(n * 10) / 10);

function comma(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '';
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(digits);
  const [i, f] = fixed.split('.');
  const frac = f ? f.replace(/0+$/, '') : '';
  const body = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '');
  return (neg && Number(fixed) !== 0 ? '-' : '') + body;
}
/** 큰 수를 억/만 단위로 줄여 쓴다 (축 눈금·막대 위 라벨용) */
function short(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e8) return `${comma(n / 1e8, a >= 1e10 ? 0 : 1)}억`;
  if (a >= 1e4) return `${comma(Math.round(n / 1e4))}만`;
  return comma(n, Number.isInteger(n) ? 0 : 1);
}
/** 글자 폭 추정 (한글·전각 ≈ 글자 크기, 그 외 ≈ 0.58배) */
function tw(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e7f ? size : size * 0.58;
  return w;
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function safeColor(c: unknown, fallback: string): string {
  const s = String(c ?? '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(s) || /^[a-zA-Z]{3,20}$/.test(s) || /^(rgb|hsl)a?\([0-9.,%\s]+\)$/.test(s) ? s : fallback;
}

type Scale = { lo: number; hi: number; ticks: number[] };
function scale(min: number, max: number, target = 4, intOnly = false): Scale {
  const lo0 = Math.min(0, min), hi0 = Math.max(0, max);
  if (hi0 - lo0 <= 0) return { lo: 0, hi: 1, ticks: [0] };
  const raw = (hi0 - lo0) / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  if (intOnly) step = Math.max(1, Math.ceil(step)); // 건수처럼 정수만 있는 값은 눈금도 정수로
  const lo = Math.floor(lo0 / step + 1e-9) * step;
  const hi = Math.ceil(hi0 / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let i = 0; lo + i * step <= hi + step * 1e-6; i++) ticks.push(Number((lo + i * step).toPrecision(12)));
  return { lo, hi, ticks };
}

function svgOpen(w: number, h: number, label: string, desc: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}" style="max-width:100%;height:auto;font-family:${FONT}">`
    + `<desc>${esc(desc)}</desc>`;
}
function text(x: number, y: number, s: string, o: { size?: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; weight?: number; halo?: boolean } = {}): string {
  const halo = o.halo ? ` stroke="${C.surface}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"` : '';
  return `<text x="${r1(x)}" y="${r1(y)}" font-size="${o.size ?? 11}" fill="${o.fill ?? C.ink2}" text-anchor="${o.anchor ?? 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}${halo}>${esc(s)}</text>`;
}
function gridAndAxis(sc: Scale, y: (v: number) => number, left: number, right: number, fmt: (n: number) => string): string {
  let out = '';
  for (const t of sc.ticks) {
    const yy = y(t);
    out += `<line x1="${r1(left)}" x2="${r1(right)}" y1="${r1(yy)}" y2="${r1(yy)}" stroke="${t === 0 ? C.axis : C.grid}" stroke-width="1"/>`;
    out += text(left - 8, yy + 4, fmt(t), { anchor: 'end', fill: C.muted, size: 11 });
  }
  return out;
}
/** 위쪽(값 끝)만 둥글고 기준선 쪽은 각진 막대 */
function barPath(x: number, w: number, yBase: number, yEnd: number, round = true): string {
  const h = Math.abs(yBase - yEnd);
  const rr = round ? Math.min(4, w / 2, h) : 0;
  const d = yEnd <= yBase ? 1 : -1; // 1 = 위로 자라는 막대
  if (rr <= 0) return `M${r1(x)},${r1(yBase)}V${r1(yEnd)}H${r1(x + w)}V${r1(yBase)}Z`;
  return `M${r1(x)},${r1(yBase)}V${r1(yEnd + d * rr)}Q${r1(x)},${r1(yEnd)} ${r1(x + rr)},${r1(yEnd)}H${r1(x + w - rr)}Q${r1(x + w)},${r1(yEnd)} ${r1(x + w)},${r1(yEnd + d * rr)}V${r1(yBase)}Z`;
}
function marker(shape: 'circle' | 'diamond', x: number, y: number, color: string, hollow = false): string {
  const fill = hollow ? C.surface : color;
  const stroke = hollow ? color : C.surface;
  const sw = hollow ? 1.5 : 2;
  if (shape === 'circle') return `<circle cx="${r1(x)}" cy="${r1(y)}" r="${hollow ? 4 : 4.5}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  const d = hollow ? 5 : 5.5;
  return `<path d="M${r1(x)},${r1(y - d)}L${r1(x + d)},${r1(y)}L${r1(x)},${r1(y + d)}L${r1(x - d)},${r1(y)}Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
const norm12 = (a: (number | null)[] | undefined): (number | null)[] => Array.from({ length: 12 }, (_, i) => num(a?.[i]));
const won = (v: number | null) => (v === null ? '미등록' : `${comma(Math.round(v))}원`);

// ─────────────────────────────────────────────────────────────
// 선택 연도 vs 전년 월별 추이 (꺾은선). null = 매출 미등록 → 선이 끊기고 기준선에 빈 표식 + '미등록'
// ─────────────────────────────────────────────────────────────
export function monthlyCompareChart(o: { year: number; current: (number | null)[]; previous: (number | null)[]; width?: number; height?: number; title?: string }): string {
  const W = Math.max(360, o.width ?? 720), H = Math.max(220, o.height ?? 320);
  const year = Number(o.year) || 0;
  const cur = norm12(o.current), prev = norm12(o.previous);
  const curName = `${year}년`, prevName = `${year - 1}년(전년)`;
  const titleH = o.title ? 24 : 0;
  const m = { l: 60, r: 16, t: titleH + 26 + 20, b: 30 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const vals = [...cur, ...prev].filter((v): v is number => v !== null);
  const sc = scale(Math.min(0, ...vals), Math.max(0, ...vals));
  const y = (v: number) => m.t + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
  const x = (i: number) => m.l + (i + 0.5) * (pw / 12);
  const y0 = y(0);

  const sum = (a: (number | null)[]) => (a.some((v) => v !== null) ? a.reduce<number>((s, v) => s + (v ?? 0), 0) : null);
  const missing = (a: (number | null)[]) => a.map((v, i) => (v === null ? `${i + 1}월` : '')).filter(Boolean);
  const desc = `${curName} 합계 ${won(sum(cur))}, ${prevName} 합계 ${won(sum(prev))}. `
    + `${curName} 미등록: ${missing(cur).join(', ') || '없음'}. ${prevName} 미등록: ${missing(prev).join(', ') || '없음'}.`;

  let s = svgOpen(W, H, o.title ?? `${curName} 월별 매출 추이 (전년 비교)`, desc);
  if (o.title) s += text(m.l - 44, 16, o.title, { size: 13, weight: 700, fill: C.ink });

  // 범례 (선 + 표식 모양으로 구분 — 색에만 의존하지 않는다)
  let lx = m.l - 44;
  const ly = titleH + 14;
  const legend = (shape: 'circle' | 'diamond', color: string, name: string) => {
    s += `<line x1="${r1(lx)}" x2="${r1(lx + 22)}" y1="${ly}" y2="${ly}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` + marker(shape, lx + 11, ly, color);
    s += text(lx + 28, ly + 4, name, { fill: C.ink2, size: 11.5 });
    lx += 28 + tw(name, 11.5) + 18;
  };
  legend('circle', C.s1, curName);
  legend('diamond', C.s2, prevName);
  s += marker('circle', lx + 5, ly, C.muted, true) + text(lx + 14, ly + 4, '미등록(매출 자료 없음)', { fill: C.ink2, size: 11.5 });
  s += text(W - m.r, ly + 4, '총금액(부가세 포함)', { anchor: 'end', fill: C.muted, size: 11 });

  s += gridAndAxis(sc, y, m.l, W - m.r, short);
  for (let i = 0; i < 12; i++) s += text(x(i), H - m.b + 18, `${i + 1}월`, { anchor: 'middle', fill: C.muted, size: 11 });

  const line = (a: (number | null)[], color: string) => {
    let d = '', pen = false;
    a.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${r1(x(i))},${r1(y(v))}`;
      pen = true;
    });
    return d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : '';
  };
  s += line(prev, C.s2) + line(cur, C.s1);

  // 표식: 값이 있으면 채운 표식, 미등록이면 기준선 위 빈 표식
  let marks = '', labels = '';
  for (let i = 0; i < 12; i++) {
    const cv = cur[i], pv = prev[i];
    // 빈 표식이 다른 표식과 겹치면(둘 다 미등록이거나 상대 값이 기준선 근처) 좌우로 벌린다
    const near = (v: number | null) => v === null || Math.abs(y(v) - y0) < 11;
    if (pv !== null) marks += marker('diamond', x(i), y(pv), C.s2);
    else marks += marker('diamond', x(i) + (near(cv) ? 7 : 0), y0, C.s2, true);
    if (cv !== null) marks += marker('circle', x(i), y(cv), C.s1);
    else marks += marker('circle', x(i) - (near(pv) ? 7 : 0), y0, C.s1, true);
    if (cv === null || pv === null) labels += text(x(i), y0 - 10, '미등록', { anchor: 'middle', size: 10, fill: C.ink2, halo: true });
  }
  // 값 라벨은 골라서: 0(미등록과 구분), 선택 연도 최댓값, 선택 연도 마지막 등록 월
  const labelIdx = new Set<number>();
  let maxI = -1, lastI = -1;
  cur.forEach((v, i) => {
    if (v === null) return;
    lastI = i;
    if (v > 0 && (maxI < 0 || v > (cur[maxI] as number))) maxI = i;
  });
  if (maxI >= 0) labelIdx.add(maxI);
  if (lastI >= 0) labelIdx.add(lastI);
  cur.forEach((v, i) => { if (v === 0) labelIdx.add(i); });
  for (const i of labelIdx) {
    const v = cur[i] as number;
    labels += text(x(i), v < 0 ? y(v) + 18 : y(v) - 10, v === 0 ? '0' : short(v), { anchor: 'middle', size: 11, weight: 600, fill: C.ink, halo: true });
  }
  prev.forEach((v, i) => {
    if (v === 0 && cur[i] !== 0) labels += text(x(i), y0 + (cur[i] === null ? -24 : -10), '0', { anchor: 'middle', size: 11, weight: 600, fill: C.ink, halo: true });
  });
  s += marks + labels;

  // 월별 안내(마우스를 올리면 두 연도 값을 함께 보여 준다)
  for (let i = 0; i < 12; i++) {
    s += `<rect x="${r1(m.l + i * (pw / 12))}" y="${r1(m.t - 16)}" width="${r1(pw / 12)}" height="${r1(ph + 16 + m.b)}" fill="transparent">`
      + `<title>${esc(`${i + 1}월 · ${curName} ${won(cur[i])} · ${prevName} ${won(prev[i])}`)}</title></rect>`;
  }
  return s + '</svg>';
}

// ─────────────────────────────────────────────────────────────
// 최근 5개년 총금액 (세로 막대) + 직전년도 대비 증감률 라벨
// ─────────────────────────────────────────────────────────────
export function yearlyChart(o: { years: { year: number; total: number | null; growth: number | null }[]; width?: number; height?: number; title?: string }): string {
  const W = Math.max(320, o.width ?? 640), H = Math.max(220, o.height ?? 320);
  const years = (o.years ?? []).map((v) => ({ year: Number(v.year) || 0, total: num(v.total), growth: num(v.growth) }));
  const n = Math.max(1, years.length);
  const titleH = o.title ? 24 : 0;
  const m = { l: 60, r: 16, t: titleH + 22 + 38, b: 30 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const vals = years.map((v) => v.total).filter((v): v is number => v !== null);
  const sc = scale(Math.min(0, ...vals), Math.max(0, ...vals));
  const y = (v: number) => m.t + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
  const slot = pw / n;
  const bw = Math.min(24, slot * 0.5);
  const y0 = y(0);
  const growthText = (g: number | null) => (g === null ? '-' : `${g > 0 ? '▲ +' : g < 0 ? '▼ ' : ''}${comma(g, 1)}%`);

  const desc = years.map((v) => `${v.year}년 ${won(v.total)}, 직전년도 대비 ${v.growth === null ? '-' : `${comma(v.growth, 1)}%`}`).join('; ');
  let s = svgOpen(W, H, o.title ?? '최근 5개년 매출 총금액', desc);
  if (o.title) s += text(m.l - 44, 16, o.title, { size: 13, weight: 700, fill: C.ink });
  s += text(m.l - 44, titleH + 14, '막대 위: 총금액(부가세 포함) · 그 위: 직전년도 대비 증감률', { fill: C.muted, size: 11 });
  s += gridAndAxis(sc, y, m.l, W - m.r, short);

  years.forEach((v, i) => {
    const cx = m.l + (i + 0.5) * slot;
    s += text(cx, H - m.b + 18, `${v.year}년`, { anchor: 'middle', fill: C.muted, size: 11.5 });
    let top = y0;
    if (v.total === null) {
      s += marker('circle', cx, y0, C.muted, true) + text(cx, y0 - 10, '미등록', { anchor: 'middle', size: 11, fill: C.ink2, halo: true });
      top = y0 - 12;
    } else {
      if (v.total !== 0) s += `<path d="${barPath(cx - bw / 2, bw, y0, y(v.total))}" fill="${C.s1}"/>`;
      top = Math.min(y0, y(v.total));
      s += text(cx, top - 7, v.total === 0 ? '0' : short(v.total), { anchor: 'middle', size: 12, weight: 700, fill: C.ink, halo: true });
    }
    const g = v.growth;
    s += text(cx, top - 23, growthText(g), { anchor: 'middle', size: 11, weight: g === null ? undefined : 600, fill: g === null ? C.muted : g > 0 ? C.up : g < 0 ? C.down : C.ink2, halo: true });
    s += `<rect x="${r1(m.l + i * slot)}" y="${r1(m.t - 38)}" width="${r1(slot)}" height="${r1(ph + 38 + m.b)}" fill="transparent">`
      + `<title>${esc(`${v.year}년 · 총금액 ${won(v.total)} · 직전년도 대비 ${g === null ? '-' : `${g > 0 ? '+' : ''}${comma(g, 1)}%`}`)}</title></rect>`;
  });
  return s + '</svg>';
}

// ─────────────────────────────────────────────────────────────
// 범용 막대 그래프 (묶음 / 누적)
// ─────────────────────────────────────────────────────────────
export function barChart(o: { labels: string[]; series: { name: string; color: string; values: number[] }[]; width?: number; height?: number; stacked?: boolean; unit?: string; title?: string }): string {
  const W = Math.max(280, o.width ?? 640), H = Math.max(180, o.height ?? 280);
  const labels = (o.labels ?? []).map((l) => String(l ?? ''));
  const palette = [C.s1, C.s2, '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const series = (o.series ?? []).map((sr, k) => ({
    name: String(sr.name ?? ''),
    color: safeColor(sr.color, palette[k % palette.length]),
    values: labels.map((_, i) => num(sr.values?.[i]) ?? 0),
  }));
  const N = Math.max(1, labels.length), S = series.length;
  const unit = o.unit ? String(o.unit) : '';
  const stacked = !!o.stacked && S > 1;
  const titleH = o.title ? 24 : 0;
  const legendH = S >= 2 ? 22 : 0;
  const m = { l: 56, r: 14, t: titleH + legendH + 24, b: 30 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;

  // 누적은 양수·음수를 따로 쌓는다
  const posSum = labels.map((_, i) => series.reduce((a, sr) => a + Math.max(0, sr.values[i]), 0));
  const negSum = labels.map((_, i) => series.reduce((a, sr) => a + Math.min(0, sr.values[i]), 0));
  const all = series.flatMap((sr) => sr.values);
  const max = stacked ? Math.max(0, ...posSum) : Math.max(0, ...all);
  const min = stacked ? Math.min(0, ...negSum) : Math.min(0, ...all);
  const sc = scale(min, max, 4, o.series.every((x) => x.values.every((v) => Number.isInteger(v))));
  const y = (v: number) => m.t + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
  const y0 = y(0);
  const slot = pw / N;
  const fmtTick = sc.hi >= 1e4 || sc.lo <= -1e4 ? short : (v: number) => comma(v, Number.isInteger(v) ? 0 : 1);
  const fmtVal = (v: number) => `${comma(v, Number.isInteger(v) ? 0 : 1)}${unit}`;

  const desc = labels.map((l, i) => `${l}: ${series.map((sr) => `${sr.name} ${fmtVal(sr.values[i])}`).join(', ')}`).join('; ');
  let s = svgOpen(W, H, o.title ?? (series.map((sr) => sr.name).join(', ') || '막대 그래프'), desc);
  if (o.title) s += text(m.l - 42, 16, o.title, { size: 13, weight: 700, fill: C.ink });
  if (S >= 2) {
    let lx = m.l - 42;
    const ly = titleH + 12;
    for (const sr of series) {
      s += `<rect x="${r1(lx)}" y="${ly - 5}" width="10" height="10" rx="2" fill="${esc(sr.color)}"/>` + text(lx + 15, ly + 4, sr.name, { fill: C.ink2, size: 11.5 });
      lx += 15 + tw(sr.name, 11.5) + 16;
    }
  }
  if (unit) s += text(W - m.r, titleH + legendH + 10, `단위: ${unit}`, { anchor: 'end', fill: C.muted, size: 11 });
  s += gridAndAxis(sc, y, m.l, W - m.r, fmtTick);

  // 가로축 라벨: 겹치면 일정 간격으로만 표시
  const widest = Math.max(0, ...labels.map((l) => tw(l, 11)));
  const every = Math.max(1, Math.ceil((widest + 6) / slot));
  labels.forEach((l, i) => {
    if (i % every === 0) s += text(m.l + (i + 0.5) * slot, H - m.b + 18, l, { anchor: 'middle', fill: C.muted, size: 11 });
  });

  let bars = '', caps = '';
  const capLabel = (cx: number, v: number, yEnd: number) => text(cx, v < 0 ? yEnd + 14 : yEnd - 6, sc.hi >= 1e4 ? short(v) : comma(v, Number.isInteger(v) ? 0 : 1), { anchor: 'middle', size: 11, weight: 600, fill: C.ink, halo: true });
  if (stacked) {
    const bw = Math.max(2, Math.min(24, slot * 0.6));
    labels.forEach((_, i) => {
      const cx = m.l + (i + 0.5) * slot;
      let up = 0, down = 0;
      const lastPos = series.map((sr) => sr.values[i] > 0).lastIndexOf(true);
      const lastNeg = series.map((sr) => sr.values[i] < 0).lastIndexOf(true);
      series.forEach((sr, k) => {
        const v = sr.values[i];
        if (v === 0) return;
        const from = v > 0 ? up : down;
        const to = from + v;
        if (v > 0) up = to; else down = to;
        let ya = y(from), yb = y(to);
        // 조각 사이 2px 바탕색 틈
        if (from !== 0 && Math.abs(ya - yb) > 3) ya += v > 0 ? -2 : 2;
        const isEnd = v > 0 ? k === lastPos : k === lastNeg;
        bars += `<path d="${barPath(cx - bw / 2, bw, ya, yb, isEnd)}" fill="${esc(sr.color)}"/>`;
      });
      const total = posSum[i] + negSum[i];
      if (N <= 16 && (posSum[i] !== 0 || negSum[i] !== 0) && tw(short(total), 11) < slot) caps += capLabel(cx, posSum[i] > 0 ? posSum[i] : negSum[i], y(posSum[i] > 0 ? posSum[i] : negSum[i]));
    });
  } else if (S > 0) {
    const gap = 2;
    const bw = Math.max(2, Math.min(24, (slot * 0.8 - gap * (S - 1)) / S));
    const groupW = bw * S + gap * (S - 1);
    const showCaps = N * S <= 16;
    labels.forEach((_, i) => {
      const gx = m.l + (i + 0.5) * slot - groupW / 2;
      series.forEach((sr, k) => {
        const v = sr.values[i];
        const bx = gx + k * (bw + gap);
        if (v !== 0) bars += `<path d="${barPath(bx, bw, y0, y(v))}" fill="${esc(sr.color)}"/>`;
        if (showCaps && tw(short(v), 11) < slot / S + 8) caps += capLabel(bx + bw / 2, v, y(v));
      });
    });
  }
  s += bars + caps;
  labels.forEach((l, i) => {
    const tip = [l, ...series.map((sr) => `${sr.name} ${fmtVal(sr.values[i])}`)];
    if (stacked) tip.push(`합계 ${fmtVal(posSum[i] + negSum[i])}`);
    s += `<rect x="${r1(m.l + i * slot)}" y="${r1(m.t - 16)}" width="${r1(slot)}" height="${r1(ph + 16 + m.b)}" fill="transparent"><title>${esc(tip.join(' · '))}</title></rect>`;
  });
  return s + '</svg>';
}
