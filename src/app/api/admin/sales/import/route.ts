// 판매내역 Excel 가져오기 (관리자 전용)
//   months 없음 → 미리보기만 (저장하지 않음)
//   months 있음 → 같은 파일을 다시 해석해 선택한 월만 한 트랜잭션으로 저장 (전부 저장되거나 전부 취소)
// 중복 방지: import_key 가 이미 있으면 건너뛴다 → 관리자가 수정한 값은 보존되고, 삭제했던 거래는 다시 등록된다.
import { route } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { parseSalesWorkbook, type ParsedWorkbook, type ParsedSale } from '@/lib/sales-import';
import { dropStaleClosings } from '@/lib/sales-data';

export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 20000;
const PREVIEW_ROWS = 500;
const CHUNK = 500;

const COLS = [
  'sale_date', 'kind', 'customer', 'product_name', 'model', 'manager', 'quantity', 'unit', 'unit_price', 'currency', 'exchange_rate',
  'supply_amount', 'vat_amount', 'total_amount', 'note', 'import_key', 'import_id', 'source_file', 'source_sheet', 'source_row',
  'orig_supply_amount', 'orig_vat_amount', 'orig_total_amount', 'created_by',
] as const;

function safeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
}

export const POST = route({ admin: true }, async ({ user, req, db }) => {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES + 1024 * 1024) throw new HttpError(413, '파일이 너무 큽니다. 10MB 이하의 Excel 파일만 올릴 수 있습니다.');
  let form: FormData;
  try { form = await req.formData(); } catch { throw new HttpError(400, '업로드 형식이 올바르지 않습니다.'); }
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'Excel 파일을 선택해 주세요.');
  const fileName = safeName(file.name);
  if (!/\.(xlsx|xls)$/i.test(fileName)) throw new HttpError(400, 'Excel 파일(.xls, .xlsx)만 가져올 수 있습니다.');
  if (file.size === 0) throw new HttpError(400, '빈 파일입니다.');
  if (file.size > MAX_BYTES) throw new HttpError(413, '파일이 너무 큽니다. 10MB 이하의 Excel 파일만 올릴 수 있습니다.');
  const buf = Buffer.from(await file.arrayBuffer());

  let parsed: ParsedWorkbook;
  try {
    parsed = parseSalesWorkbook(buf, fileName);
  } catch {
    throw new HttpError(400, 'Excel 파일을 읽을 수 없습니다. 파일이 손상되었거나 암호가 걸려 있는지 확인해 주세요.');
  }
  if (parsed.rows.length > MAX_ROWS) throw new HttpError(400, `한 번에 ${MAX_ROWS.toLocaleString()}행까지 가져올 수 있습니다. 파일을 나누어 올려 주세요.`);

  const monthsRaw = form.get('months');

  // ── 미리보기 ──
  if (monthsRaw === null) {
    const keys = parsed.rows.map((r) => r.import_key);
    const existing = new Set<string>();
    if (keys.length) {
      await db(async (tx) => {
        for (let i = 0; i < keys.length; i += 5000) {
          const part = keys.slice(i, i + 5000);
          const found = await tx`select import_key from sales where import_key = any(${part}::text[])`;
          for (const f of found) existing.add(String(f.import_key));
        }
      });
    }
    const months = parsed.months.map((m) => {
      const dup = parsed.rows.filter((r) => r.month === m.month && existing.has(r.import_key)).length;
      return { ...m, newCount: m.count - dup, dupCount: dup };
    });
    return {
      mode: 'preview',
      fileName, sheets: parsed.sheets, months, errors: parsed.errors, warnings: parsed.warnings, skipped: parsed.skipped,
      totalRows: parsed.rows.length,
      rows: parsed.rows.slice(0, PREVIEW_ROWS).map(({ import_key, ...r }) => ({ ...r, isNew: !existing.has(import_key) })),
      truncated: parsed.rows.length > PREVIEW_ROWS,
    };
  }

  // ── 저장 ──
  if (typeof monthsRaw !== 'string') throw new HttpError(400, '저장할 월 값이 올바르지 않습니다.');
  const months = [...new Set(monthsRaw.split(',').map((s) => s.trim()).filter(Boolean))].sort();
  if (!months.length) throw new HttpError(400, '저장할 월을 하나 이상 선택해 주세요.');
  const inFile = new Set(parsed.months.map((m) => m.month));
  for (const m of months) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new HttpError(400, '저장할 월 값이 올바르지 않습니다. (예: 2026-11)');
    if (!inFile.has(m)) throw new HttpError(400, `파일에 ${m} 거래가 없습니다. 미리보기를 다시 확인해 주세요.`);
  }
  const pick = new Set(months);
  const rows: ParsedSale[] = parsed.rows.filter((r) => pick.has(r.month));

  return db(async (tx) => {
    const [imp] = await tx`insert into sales_imports (file_name, months, imported_by) values (${fileName}, ${months.join(',')}, ${user.id}) returning id`;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const recs = rows.slice(i, i + CHUNK).map((r) => ({
        sale_date: r.sale_date, kind: r.kind, customer: r.customer, product_name: r.product_name, model: r.model, manager: r.manager,
        quantity: r.quantity, unit: r.unit, unit_price: r.unit_price, currency: r.currency, exchange_rate: r.exchange_rate,
        supply_amount: r.supply_amount, vat_amount: r.vat_amount, total_amount: r.total_amount, note: r.note,
        import_key: r.import_key, import_id: imp.id as string, source_file: fileName, source_sheet: r.sheet, source_row: r.row,
        orig_supply_amount: r.orig_supply_amount, orig_vat_amount: r.orig_vat_amount, orig_total_amount: r.orig_total_amount,
        created_by: user.id,
      }));
      // 이미 같은 키가 있으면(수정된 행 포함) 건드리지 않는다
      const done = await tx`insert into sales ${tx(recs, ...COLS)} on conflict (import_key) do nothing returning id`;
      inserted += done.length;
    }
    const skipped = rows.length - inserted;
    await tx`update sales_imports set inserted = ${inserted}, skipped = ${skipped} where id = ${imp.id}`;
    await dropStaleClosings(tx, months.map((m) => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) })));
    return { ok: true, mode: 'save', inserted, skipped, months, importId: imp.id };
  });
});
