'use client';
// 거래 상세·수정 / 직접 추가 모달. 금액은 직접 입력할 수 있고, "금액 다시 계산"으로 수량×단가×환율을 채울 수 있다.
import { useState } from 'react';
import { api, Button, Field, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { SALE_KIND, fmtDateTime, fmtNum } from '@/lib/constants';
import type { SaleRow } from '@/lib/sales-data';

type Form = {
  sale_date: string; kind: string; customer: string; product_name: string; model: string; manager: string;
  quantity: string; unit: string; unit_price: string; currency: string; exchange_rate: string;
  supply_amount: string; vat_amount: string; total_amount: string; note: string;
};
const s = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const n = (v: string): number | null => {
  const t = v.replace(/[,\s]/g, '');
  if (t === '') return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : NaN;
};

export function SaleFormModal({ sale, defaultDate, onClose, onSaved, onStale }: {
  sale: SaleRow | null; defaultDate: string; onClose: () => void; onSaved: (saleDate: string) => void; onStale: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Form>(() => sale ? {
    sale_date: sale.sale_date, kind: sale.kind, customer: sale.customer, product_name: sale.product_name, model: sale.model, manager: sale.manager,
    quantity: s(sale.quantity), unit: sale.unit, unit_price: s(sale.unit_price), currency: sale.currency, exchange_rate: s(sale.exchange_rate),
    supply_amount: s(sale.supply_amount), vat_amount: s(sale.vat_amount), total_amount: s(sale.total_amount), note: sale.note,
  } : {
    sale_date: defaultDate, kind: 'sale', customer: '', product_name: '', model: '', manager: '',
    quantity: '', unit: 'EA', unit_price: '', currency: 'KRW', exchange_rate: '1', supply_amount: '', vat_amount: '', total_amount: '', note: '',
  });
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const optionalQty = f.kind === 'freight' || f.kind === 'misc';

  /** 공급가액 = 수량×단가×환율, 총금액 = 공급가액 + 부가세액. 반품은 음수로 맞춘다. */
  const recalc = (vat10 = false) => {
    let q = n(f.quantity);
    const p = n(f.unit_price);
    const rate = n(f.exchange_rate) ?? 1;
    let supply = n(f.supply_amount);
    let vat = n(f.vat_amount) ?? 0;
    if ([q, p, rate, supply, vat].some((v) => v !== null && Number.isNaN(v))) return toast('숫자가 아닌 값이 있습니다. 수량·단가·금액을 확인해 주세요.', 'err');
    const isReturn = f.kind === 'return';
    if (isReturn && q !== null) q = -Math.abs(q);
    if (q !== null && p !== null) supply = Math.round(q * Math.abs(p) * rate);
    if (supply === null) return toast('수량과 단가를 입력하거나 공급가액을 직접 입력해 주세요.', 'err');
    if (isReturn) supply = -Math.abs(supply);
    if (vat10) vat = Math.round(supply * 0.1);
    else if (isReturn) vat = -Math.abs(vat);
    setF((prev) => ({
      ...prev, quantity: q === null ? prev.quantity : String(q), unit_price: p === null ? prev.unit_price : String(Math.abs(p)),
      supply_amount: String(supply), vat_amount: String(vat), total_amount: String(supply! + vat),
    }));
  };

  const save = async () => {
    const nums = { quantity: n(f.quantity), unit_price: n(f.unit_price), exchange_rate: n(f.exchange_rate), supply_amount: n(f.supply_amount), vat_amount: n(f.vat_amount), total_amount: n(f.total_amount) };
    if (Object.values(nums).some((v) => v !== null && Number.isNaN(v))) return toast('숫자가 아닌 값이 있습니다. 수량·단가·금액을 확인해 주세요.', 'err');
    if (!f.sale_date) return toast('납품일을 입력해 주세요.', 'err');
    const body = { ...f, ...nums, exchange_rate: nums.exchange_rate ?? 1, vat_amount: nums.vat_amount ?? 0 };
    setBusy(true);
    try {
      if (sale) await api('PATCH', `/api/admin/sales/${sale.id}`, { ...body, version: sale.version });
      else await api('POST', '/api/admin/sales', body);
      toast(sale ? '수정했습니다.' : '거래를 추가했습니다.');
      onSaved(f.sale_date);
    } catch (e) {
      const msg = (e as Error).message;
      toast(msg, 'err');
      if (/먼저 수정|찾을 수 없습니다/.test(msg)) onStale();
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!sale) return;
    if (!window.confirm('이 거래를 삭제할까요?\n삭제한 거래는 되돌릴 수 없습니다.')) return;
    setBusy(true);
    try {
      await api('POST', '/api/admin/sales/bulk-delete', { ids: [sale.id] });
      toast('1건을 삭제했습니다.');
      onSaved(sale.sale_date);
    } catch (e) { toast((e as Error).message, 'err'); onStale(); } finally { setBusy(false); }
  };

  const numCls = 'text-right tabular-nums';
  const origChanged = !!sale && sale.orig_total_amount !== null && (sale.orig_supply_amount !== sale.supply_amount || sale.orig_vat_amount !== sale.vat_amount || sale.orig_total_amount !== sale.total_amount);

  return (
    <Modal open onClose={onClose} wide title={sale ? '거래 상세 · 수정' : '거래 추가 (직접 입력)'}
      footer={<>
        {sale && <Button variant="danger" disabled={busy} onClick={remove} className="mr-auto">삭제</Button>}
        <Button onClick={onClose} disabled={busy}>닫기</Button>
        <Button variant="primary" onClick={save} disabled={busy}>{busy ? '저장 중…' : '저장'}</Button>
      </>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="납품일" required><Input type="date" value={f.sale_date} onChange={set('sale_date')} /></Field>
        <Field label="구분" required>
          <Select value={f.kind} onChange={set('kind')}>
            {Object.entries(SALE_KIND).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </Select>
        </Field>
        <Field label="거래처" className="col-span-2"><Input value={f.customer} onChange={set('customer')} maxLength={200} /></Field>
        <Field label="제품" className="col-span-2"><Input value={f.product_name} onChange={set('product_name')} maxLength={200} /></Field>
        <Field label="모델"><Input value={f.model} onChange={set('model')} maxLength={200} /></Field>
        <Field label="담당자"><Input value={f.manager} onChange={set('manager')} maxLength={200} /></Field>

        <Field label="수량" required={!optionalQty} hint={optionalQty ? '운임·기타자재는 비워 둘 수 있습니다' : f.kind === 'return' ? '반품은 음수(-)' : undefined}>
          <Input inputMode="decimal" className={numCls} value={f.quantity} onChange={set('quantity')} />
        </Field>
        <Field label="단위"><Input value={f.unit} onChange={set('unit')} maxLength={20} placeholder="EA, SET …" /></Field>
        <Field label="단가" required={!optionalQty}><Input inputMode="decimal" className={numCls} value={f.unit_price} onChange={set('unit_price')} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="통화"><Input value={f.currency} onChange={set('currency')} maxLength={10} /></Field>
          <Field label="환율"><Input inputMode="decimal" className={numCls} value={f.exchange_rate} onChange={set('exchange_rate')} /></Field>
        </div>

        <Field label="공급가액 (원)" required><Input inputMode="decimal" className={numCls} value={f.supply_amount} onChange={set('supply_amount')} /></Field>
        <Field label="부가세액 (원)"><Input inputMode="decimal" className={numCls} value={f.vat_amount} onChange={set('vat_amount')} /></Field>
        <Field label="총금액 (부가세 포함, 원)" required><Input inputMode="decimal" className={`${numCls} font-semibold`} value={f.total_amount} onChange={set('total_amount')} /></Field>
        <div className="flex flex-wrap items-end gap-2 pb-0.5">
          <Button size="sm" onClick={() => recalc(false)} title="공급가액 = 수량 × 단가 × 환율, 총금액 = 공급가액 + 부가세액">금액 다시 계산</Button>
          <Button size="sm" variant="ghost" onClick={() => recalc(true)} title="부가세액을 공급가액의 10%로 채우고 다시 계산">부가세 10%</Button>
        </div>
        <p className="col-span-2 -mt-1 text-xs text-slate-500 md:col-span-4">
          공급가액 = 수량 × 단가 × 환율, 총금액 = 공급가액 + 부가세액. 금액은 직접 고쳐 쓸 수 있으며 총금액은 공급가액 + 부가세액과 같아야 합니다(±1원).
        </p>
        <Field label="비고" className="col-span-2 md:col-span-4"><Textarea rows={2} value={f.note} onChange={set('note')} maxLength={2000} /></Field>
      </div>

      {sale && (
        <section aria-label="추적 정보" className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <h3 className="mb-2 text-xs font-semibold text-slate-600">추적 정보 (수정되지 않는 기록)</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <Info label="등록 방법" value={sale.import_key ? 'Excel 가져오기' : '직접 입력'} />
            <Info label="수정 여부" value={sale.is_edited ? `수정됨 (${fmtDateTime(sale.updated_at)})` : '수정 없음'} />
            <Info label="가져온 파일" value={sale.source_file ?? '-'} />
            <Info label="시트 / 행 번호" value={sale.source_sheet ? `${sale.source_sheet} / ${sale.source_row ?? '-'}행` : '-'} />
            <Info label="원본 공급가액" value={sale.orig_supply_amount === null ? '-' : `${fmtNum(sale.orig_supply_amount, 2)}원`} />
            <Info label="원본 부가세액" value={sale.orig_vat_amount === null ? '-' : `${fmtNum(sale.orig_vat_amount, 2)}원`} />
            <Info label="원본 총금액" value={sale.orig_total_amount === null ? '-' : `${fmtNum(sale.orig_total_amount, 2)}원`} />
            <Info label="등록 일시" value={fmtDateTime(sale.created_at)} />
          </dl>
          {origChanged && <p className="mt-2 text-xs text-amber-800">현재 금액이 가져온 원본 금액과 다릅니다. 같은 파일을 다시 가져와도 수정한 값은 그대로 유지됩니다.</p>}
        </section>
      )}
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 break-all text-slate-800 tabular-nums">{value}</dd>
    </div>
  );
}
