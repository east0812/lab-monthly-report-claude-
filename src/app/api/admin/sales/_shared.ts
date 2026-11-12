// 매출 API 공용: 입력 검증
import { HttpError } from '@/lib/db';
import { str, text, oneOf, optNum, num, optDate } from '@/lib/validate';

export const SALE_KINDS = ['sale', 'return', 'freight', 'misc'] as const;
export type SaleInput = {
  sale_date: string; kind: (typeof SALE_KINDS)[number];
  customer: string; product_name: string; model: string; manager: string;
  quantity: number | null; unit: string; unit_price: number | null;
  currency: string; exchange_rate: number;
  supply_amount: number; vat_amount: number; total_amount: number; note: string;
};

const LIMIT = 1e13;
function bounded(n: number | null, name: string): number | null {
  if (n !== null && Math.abs(n) >= LIMIT) throw new HttpError(400, `${name}: 숫자가 너무 큽니다.`);
  return n;
}
const round = (n: number, d: number) => { const f = 10 ** d; const v = Math.round(n * f) / f; return v === 0 ? 0 : v; };

/** 직접 입력·수정 값 검증. 판매/반품은 수량·단가 필수, 총금액 = 공급가액 + 부가세액(±1원). */
export function parseSaleBody(b: Record<string, unknown>): SaleInput {
  const sale_date = optDate(b.sale_date, '납품일');
  if (!sale_date) throw new HttpError(400, '납품일: 값을 입력해 주세요.');
  const y = Number(sale_date.slice(0, 4));
  if (y < 2000 || y > 2100) throw new HttpError(400, '납품일: 2000년~2100년 사이의 날짜를 입력해 주세요.');
  const kind = oneOf(b.kind ?? 'sale', SALE_KINDS, '구분');
  const quantity = bounded(optNum(b.quantity, '수량'), '수량');
  const unit_price = bounded(optNum(b.unit_price, '단가'), '단가');
  if ((kind === 'sale' || kind === 'return') && (quantity === null || unit_price === null))
    throw new HttpError(400, '판매·반품 거래는 수량과 단가를 입력해야 합니다. (운임·기타자재만 비울 수 있습니다)');
  const exchange_rate = b.exchange_rate === undefined || b.exchange_rate === null || b.exchange_rate === '' ? 1 : num(b.exchange_rate, '환율');
  if (!(exchange_rate > 0) || exchange_rate >= 1e9) throw new HttpError(400, '환율: 0보다 큰 값을 입력해 주세요.');
  const supply_amount = bounded(num(b.supply_amount, '공급가액'), '공급가액')!;
  const vat_amount = bounded(optNum(b.vat_amount, '부가세액') ?? 0, '부가세액')!;
  const total_amount = bounded(num(b.total_amount, '총금액'), '총금액')!;
  if (Math.abs(total_amount - (supply_amount + vat_amount)) > 1.000001)
    throw new HttpError(400, '총금액은 공급가액과 부가세액을 더한 값과 같아야 합니다. (허용 오차 1원)');
  if (kind === 'return' && ((quantity ?? 0) > 0 || supply_amount > 0 || total_amount > 0))
    throw new HttpError(400, '반품은 매출에서 차감되도록 수량과 금액을 음수(-)로 입력해 주세요.');
  return {
    sale_date, kind,
    customer: str(b.customer, 200, '거래처'), product_name: str(b.product_name, 200, '제품'),
    model: str(b.model, 200, '모델'), manager: str(b.manager, 200, '담당자'),
    quantity: quantity === null ? null : round(quantity, 4), unit: str(b.unit, 20, '단위'),
    unit_price: unit_price === null ? null : round(unit_price, 4),
    currency: (str(b.currency, 10, '통화') || 'KRW').toUpperCase(), exchange_rate: round(exchange_rate, 6),
    supply_amount: round(supply_amount, 2), vat_amount: round(vat_amount, 2), total_amount: round(total_amount, 2),
    note: text(b.note, 2000, '비고'),
  };
}

export const SALE_COLUMNS = [
  'sale_date', 'kind', 'customer', 'product_name', 'model', 'manager', 'quantity', 'unit', 'unit_price',
  'currency', 'exchange_rate', 'supply_amount', 'vat_amount', 'total_amount', 'note',
] as const;

export const ymOf = (date: string) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });
