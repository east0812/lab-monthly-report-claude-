// 판매내역 Excel(.xls/.xlsx) 해석기. DB·요청과 무관한 순수 함수라 단독으로 시험할 수 있다.
//   parseSalesWorkbook(buf, fileName) → 유효 행 / 오류 행(시트명 + 행 번호 + 사유) / 월별 묶음
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import type { UnitQty } from './sales-data';

// 오래된 .xls(EUC-KR 등 코드페이지 문자열)도 읽을 수 있게 한다.
XLSX.set_cptable(cptable);

export type SaleKind = 'sale' | 'return' | 'freight' | 'misc';
export type ParsedSale = {
  sheet: string;
  /** Excel 행 번호 (1부터) */
  row: number;
  /** 'YYYY-MM' */
  month: string;
  sale_date: string;
  kind: SaleKind;
  customer: string; product_name: string; model: string; manager: string;
  quantity: number | null; unit: string; unit_price: number | null;
  currency: string; exchange_rate: number;
  supply_amount: number; vat_amount: number; total_amount: number;
  /** 시트에 적혀 있던 원본 금액 (반품은 부호 반전 후). 시트에 없던 값은 null */
  orig_supply_amount: number | null; orig_vat_amount: number | null; orig_total_amount: number | null;
  note: string;
  import_key: string;
};
export type ImportRowError = { sheet: string; row: number; reason: string };
export type ImportMonth = { month: string; count: number; supply: number; vat: number; total: number; qty: UnitQty[] };
export type ImportSheet = { name: string; headerRow: number | null; valid: number; invalid: number; skippedEmpty: number; skippedSummary: number };
export type ParsedWorkbook = {
  fileName: string;
  sheets: ImportSheet[];
  rows: ParsedSale[];
  errors: ImportRowError[];
  months: ImportMonth[];
  warnings: string[];
  skipped: { empty: number; summary: number };
};

type Field =
  | 'date' | 'kind' | 'customer' | 'product' | 'model' | 'manager' | 'quantity' | 'unit' | 'price'
  | 'currency' | 'rate' | 'supply' | 'vat' | 'total' | 'note';

// 머리글 동의어 (앞에 있을수록 우선). 공백·괄호 안 글자는 빼고 비교한다.
const HEADERS: [Field, string[]][] = [
  ['date', ['납품일', '납품일자', '매출일', '매출일자', '거래일자', '거래일', '판매일', '판매일자', '일자', '날짜', '출고일', '출고일자']],
  ['kind', ['구분', '거래구분', '유형', '거래유형', '매출구분']],
  ['customer', ['거래처', '거래처명', '고객', '고객명', '고객사', '업체', '업체명', '납품처']],
  ['product', ['품명', '품목', '품목명', '제품', '제품명']],
  ['model', ['모델', '모델명', '규격']],
  ['manager', ['담당자', '담당', '담당자명', '영업담당']],
  ['quantity', ['수량']],
  ['unit', ['단위']],
  ['price', ['단가']],
  ['currency', ['통화', '화폐']],
  ['rate', ['환율']],
  ['supply', ['공급가액', '공급가', '공급금액']],
  ['vat', ['부가세', '부가세액', '세액', 'vat']],
  ['total', ['합계금액', '합계', '총금액', '총액', '금액']],
  ['note', ['비고', '적요', '메모']],
];
const DATE_WORDS = new Set(HEADERS[0][1]);
const SUMMARY_RE = /(합계|소계|총계|누계)/;
const HEADER_SCAN_ROWS = 30;

type Cell = { v?: unknown; t?: string; w?: string };

const clean = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
function cellText(c: Cell | undefined): string {
  if (!c || c.v === null || c.v === undefined || c.t === 'z') return '';
  if (c.v instanceof Date) return isNaN(c.v.getTime()) ? '' : kstDate(c.v);
  if (c.t === 'e') return c.w ? String(c.w) : '#오류';
  return clean(String(c.v));
}
function headerKey(s: string): string {
  const base = s.replace(/\s+/g, '').toLowerCase();
  const stripped = base.replace(/[([（［].*?[)\]）］]/g, '');
  return stripped || base;
}

// ── 날짜: 시간대 변환 없이 연·월·일만 다룬다 ─────────────────
const pad = (n: number) => String(n).padStart(2, '0');
function ymd(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
/** Date 객체는 한국시간 기준 날짜로 읽는다 (UTC 자정·KST 자정 어느 쪽으로 만들어졌어도 같은 날이 된다). */
function kstDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function fromSerial(n: number, date1904: boolean): string | null {
  // Excel 날짜 일련번호 → 연·월·일 (정수 계산만, 시간대 무관)
  const p = XLSX.SSF.parse_date_code(n, { date1904 }) as { y: number; m: number; d: number } | null;
  return p ? ymd(p.y, p.m, p.d) : null;
}
function fromCompact(n: number): string | null {
  return ymd(Math.floor(n / 10000), Math.floor(n / 100) % 100, n % 100);
}
export function parseSaleDate(v: unknown, date1904 = false): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const [y, m, d] = kstDate(v).split('-').map(Number);
    return ymd(y, m, d);
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    if (Number.isInteger(v) && v >= 20000101 && v <= 21001231) return fromCompact(v);
    if (v >= 1 && v < 2958466) return fromSerial(v, date1904);
    return null;
  }
  const s = clean(String(v));
  if (!s) return null;
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  // 2026-11-03, 2026.11.03, 2026/11/3, 2026. 11. 3., 2026년 11월 3일 (+ 뒤따르는 시각은 무시)
  m = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*[.일]?(?:$|[\sT(])/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  // 26-11-03, 26.11.03 (두 자리 연도 = 20xx)
  m = /^(\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?$/.exec(s);
  if (m) return ymd(2000 + +m[1], +m[2], +m[3]);
  if (/^\d{5}(\.\d+)?$/.test(s)) return fromSerial(Number(s), date1904);
  return null;
}

// ── 숫자 ────────────────────────────────────────────────────
type NumResult = { ok: true; value: number | null } | { ok: false; raw: string };
function parseNumCell(c: Cell | undefined): NumResult {
  if (!c || c.v === null || c.v === undefined || c.t === 'z') return { ok: true, value: null };
  if (typeof c.v === 'number') return Number.isFinite(c.v) ? { ok: true, value: c.v } : { ok: false, raw: String(c.v) };
  if (typeof c.v === 'boolean' || c.v instanceof Date || c.t === 'e') return { ok: false, raw: cellText(c) };
  const raw = clean(String(c.v));
  if (raw === '' || raw === '-') return { ok: true, value: null };
  let s = raw.replace(/[,\s]/g, '').replace(/^[₩￦$]/, '').replace(/원$/, '');
  let neg = false;
  const paren = /^\((.+)\)$/.exec(s);
  if (paren) { neg = true; s = paren[1]; }
  if (/^[△▲]/.test(s)) { neg = true; s = s.slice(1); } // 회계 서식의 음수 표기
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return { ok: false, raw };
  const n = Number(s);
  return Number.isFinite(n) ? { ok: true, value: neg ? -n : n } : { ok: false, raw };
}
const round = (n: number, d: number) => {
  const f = 10 ** d;
  const v = Math.round((n + Math.sign(n) * 1e-9) * f) / f;
  return v === 0 ? 0 : v;
};

function kindOf(kindText: string, product: string, qty: number | null, price: number | null): SaleKind {
  const t = kindText.replace(/\s+/g, '');
  if (/반품|환입/.test(t)) return 'return';
  if (/운임|운송|배송/.test(t)) return 'freight';
  if (/기타|자재/.test(t)) return 'misc';
  if (qty === null && price === null && /^(운임|운송비|운송료|운반비|배송비|택배비)/.test(product.replace(/\s+/g, ''))) return 'freight';
  return 'sale';
}

const keyNum = (n: number | null) => (n === null ? '' : String(round(n, 4)));
/** 같은 거래를 다시 올려도 같은 값이 나오는 키의 앞부분 (뒤에 '#n' 을 붙여 완성) */
export function saleTupleHash(r: Pick<ParsedSale, 'sale_date' | 'kind' | 'customer' | 'product_name' | 'model' | 'quantity' | 'unit' | 'unit_price' | 'currency' | 'supply_amount' | 'vat_amount' | 'total_amount'>): string {
  const tuple = [
    r.sale_date, r.kind, clean(r.customer), clean(r.product_name), clean(r.model), keyNum(r.quantity), clean(r.unit),
    keyNum(r.unit_price), clean(r.currency).toUpperCase(), keyNum(r.supply_amount), keyNum(r.vat_amount), keyNum(r.total_amount),
  ];
  return createHash('sha256').update(JSON.stringify(tuple), 'utf8').digest('hex');
}

function mapHeader(cells: Map<number, Cell>): Map<Field, number> | null {
  const keys = new Map<number, string>();
  for (const [c, cell] of cells) {
    if (cell.t === 'n' || typeof cell.v === 'number') continue; // 머리글은 글자
    const k = headerKey(cellText(cell));
    if (k) keys.set(c, k);
  }
  const used = new Set<number>();
  const map = new Map<Field, number>();
  const cols = [...keys.keys()].sort((a, b) => a - b);
  for (const [field, words] of HEADERS) {
    outer: for (const w of words) {
      for (const c of cols) {
        if (!used.has(c) && keys.get(c) === w) { map.set(field, c); used.add(c); break outer; }
      }
    }
  }
  if (!map.has('date') || map.size < 3) return null;
  return map;
}

export function parseSalesWorkbook(buf: Buffer, fileName: string): ParsedWorkbook {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellFormula: false, cellHTML: false, cellStyles: false });
  const date1904 = !!wb.Workbook?.WBProps?.date1904;
  const out: ParsedWorkbook = { fileName, sheets: [], rows: [], errors: [], months: [], warnings: [], skipped: { empty: 0, summary: 0 } };
  const seen = new Map<string, number>(); // 동일 거래 튜플 → 파일 안에서 나온 횟수

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name] as Record<string, unknown> | undefined;
    if (!ws) continue;
    // 셀을 행 단위로 모은다 ('!ref' 범위가 과하게 넓어도 실제 셀만 본다)
    const grid = new Map<number, Map<number, Cell>>();
    for (const addr of Object.keys(ws)) {
      if (addr.charCodeAt(0) === 33) continue; // '!'
      const cell = ws[addr] as Cell;
      if (!cell || cell.v === undefined || cell.v === null || cell.t === 'z') continue;
      if (typeof cell.v === 'string' && cell.v.trim() === '') continue;
      const { r, c } = XLSX.utils.decode_cell(addr);
      let row = grid.get(r);
      if (!row) grid.set(r, (row = new Map()));
      row.set(c, cell);
    }
    if (grid.size === 0) continue; // 빈 시트
    const rowNos = [...grid.keys()].sort((a, b) => a - b);

    let header: Map<Field, number> | null = null;
    let headerR = -1;
    for (const r of rowNos) {
      if (r >= HEADER_SCAN_ROWS) break;
      header = mapHeader(grid.get(r)!);
      if (header) { headerR = r; break; }
    }
    const info: ImportSheet = { name, headerRow: header ? headerR + 1 : null, valid: 0, invalid: 0, skippedEmpty: 0, skippedSummary: 0 };
    out.sheets.push(info);
    if (!header) {
      out.warnings.push(`시트 "${name}": 처음 ${HEADER_SCAN_ROWS}행 안에서 머리글 행(납품일·거래처·금액 등)을 찾지 못해 건너뛰었습니다.`);
      continue;
    }
    const col = (f: Field) => header!.get(f);
    const dataRows = rowNos.filter((r) => r > headerR);
    if (dataRows.length) info.skippedEmpty = dataRows[dataRows.length - 1] - headerR - dataRows.length;

    for (const r of dataRows) {
      const cells = grid.get(r)!;
      const at = (f: Field): Cell | undefined => { const c = col(f); return c === undefined ? undefined : cells.get(c); };
      const str = (f: Field, max = 200) => cellText(at(f)).slice(0, max);
      const rowNo = r + 1;

      const dateCell = at('date');
      const dateText = cellText(dateCell);
      const saleDate = dateCell ? parseSaleDate(dateCell.v, date1904) : null;

      if (!saleDate) {
        // 합계·소계·총계·누계 행, 중간에 반복된 머리글 행은 조용히 건너뛴다
        const firstTexts = [...cells.entries()].sort((a, b) => a[0] - b[0]).slice(0, 3).map(([, c]) => cellText(c));
        if ([dateText, ...firstTexts].some((t) => SUMMARY_RE.test(t.replace(/\s+/g, '')))) { info.skippedSummary++; continue; }
        if (DATE_WORDS.has(headerKey(dateText))) { info.skippedSummary++; continue; }
      }

      const reasons: string[] = [];
      if (!saleDate) reasons.push(dateText ? `납품일 날짜 형식이 올바르지 않습니다 (값: ${dateText.slice(0, 30)})` : '납품일이 비어 있습니다');

      const numOf = (f: Field, label: string): number | null => {
        const res = parseNumCell(at(f));
        if (!res.ok) { reasons.push(`${label} 값이 숫자가 아닙니다 (값: ${res.raw.slice(0, 30)})`); return null; }
        return res.value;
      };
      let quantity = numOf('quantity', '수량');
      let price = numOf('price', '단가');
      const rateRaw = numOf('rate', '환율');
      let supply = numOf('supply', '공급가액');
      let vat = numOf('vat', '부가세');
      let total = numOf('total', '합계금액');
      const numericOk = reasons.length === (saleDate ? 0 : 1);

      const product = str('product');
      const kind = kindOf(str('kind'), product, quantity, price);
      const rate = rateRaw === null ? 1 : rateRaw;
      if (rateRaw !== null && rateRaw <= 0) reasons.push('환율은 0보다 커야 합니다');

      if (numericOk) {
        if ((kind === 'sale' || kind === 'return') && (quantity === null || price === null)) {
          const miss = [quantity === null ? '수량' : '', price === null ? '단가' : ''].filter(Boolean).join('·');
          reasons.push(`${kind === 'sale' ? '판매' : '반품'} 거래에 ${miss} 값이 없습니다 (운임·기타자재만 비울 수 있습니다)`);
        }
        // 반품은 차감: 수량·금액을 음수로 맞춘다 (단가는 양수 유지)
        if (kind === 'return') {
          if (quantity !== null) quantity = -Math.abs(quantity);
          if (price !== null) price = Math.abs(price);
          if (supply !== null) supply = -Math.abs(supply);
          if (vat !== null) vat = -Math.abs(vat);
          if (total !== null) total = -Math.abs(total);
        }
      }
      const orig = { supply, vat, total };
      // 금액은 시트 값을 그대로 쓰고, 비어 있을 때만 계산한다
      if (numericOk && rate > 0) {
        if (supply === null) {
          if (quantity !== null && price !== null) supply = round(quantity * price * rate, 2);
          else if (total !== null) supply = round(total - (vat ?? 0), 2);
        }
        if (supply === null) reasons.push('공급가액·합계금액이 모두 비어 있어 금액을 알 수 없습니다');
        else {
          if (vat === null) vat = total !== null ? round(total - supply, 2) : 0;
          if (total === null) total = round(supply + vat, 2);
          if ([supply, vat, total].some((v) => Math.abs(v) >= 1e15) || [quantity, price].some((v) => v !== null && Math.abs(v) >= 1e13)) reasons.push('숫자가 너무 큽니다');
        }
      }

      if (reasons.length || !saleDate || supply === null || vat === null || total === null) {
        info.invalid++;
        out.errors.push({ sheet: name, row: rowNo, reason: reasons.join(' / ') || '해석할 수 없는 행입니다' });
        continue;
      }

      const base = {
        sale_date: saleDate, kind,
        customer: str('customer'), product_name: product, model: str('model'), manager: str('manager'),
        quantity: quantity === null ? null : round(quantity, 4), unit: str('unit', 20),
        unit_price: price === null ? null : round(price, 4),
        currency: (str('currency', 10) || 'KRW').toUpperCase(), exchange_rate: round(rate, 6),
        supply_amount: round(supply, 2), vat_amount: round(vat, 2), total_amount: round(total, 2),
      };
      const hash = saleTupleHash(base);
      const n = (seen.get(hash) ?? 0) + 1;
      seen.set(hash, n);
      out.rows.push({
        sheet: name, row: rowNo, month: saleDate.slice(0, 7), ...base,
        orig_supply_amount: orig.supply === null ? null : round(orig.supply, 2),
        orig_vat_amount: orig.vat === null ? null : round(orig.vat, 2),
        orig_total_amount: orig.total === null ? null : round(orig.total, 2),
        note: str('note', 1000),
        import_key: `${hash}#${n}`,
      });
      info.valid++;
    }
    out.skipped.empty += info.skippedEmpty;
    out.skipped.summary += info.skippedSummary;
  }

  out.months = groupMonths(out.rows);
  if (out.sheets.length === 0) out.warnings.push('파일에 내용이 있는 시트가 없습니다.');
  return out;
}

/** 유효 행을 납품일의 월별로 묶어 건수·금액·단위별 수량을 낸다 */
export function groupMonths(rows: ParsedSale[]): ImportMonth[] {
  const map = new Map<string, ImportMonth & { units: Map<string, number> }>();
  for (const r of rows) {
    let g = map.get(r.month);
    if (!g) map.set(r.month, (g = { month: r.month, count: 0, supply: 0, vat: 0, total: 0, qty: [], units: new Map() }));
    g.count++;
    g.supply += r.supply_amount; g.vat += r.vat_amount; g.total += r.total_amount;
    if (r.unit && r.quantity !== null) g.units.set(r.unit, (g.units.get(r.unit) ?? 0) + r.quantity);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month)).map(({ units, ...g }) => ({
    ...g, supply: round(g.supply, 2), vat: round(g.vat, 2), total: round(g.total, 2),
    qty: [...units].map(([unit, qty]) => ({ unit, qty: round(qty, 4) })).sort((a, b) => a.unit.localeCompare(b.unit, 'ko')),
  }));
}
