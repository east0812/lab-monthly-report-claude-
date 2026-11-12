'use client';
// 개별 매출내역 탭: 월 요약, 표(검색·필터·정렬·열 너비), 상세/수정, 직접 추가, 일괄 삭제, Excel 가져오기, 0원 확정
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Badge, Button, Card, YearMonthNav, useToast } from '@/components/ui';
import { DataTable, type Column } from '@/components/DataTable';
import { SALE_KIND, fmtNum, fmtWon } from '@/lib/constants';
import { fmtUnitQty, type SaleRow, type SalesMonth } from '@/lib/sales-data';
import { KIND_CLS, MonthState } from './parts';
import { SaleFormModal } from './SaleFormModal';
import { SalesImportModal } from './SalesImportModal';

const neg = (n: number | null) => (n !== null && n < 0 ? 'text-rose-700' : undefined);

export function SalesList({ year, month, rows, summary }: { year: number; month: number; rows: SaleRow[]; summary: SalesMonth }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<SaleRow | 'new' | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // 새로 고침으로 사라진 행은 선택에서 뺀다
  const liveSelected = useMemo(() => {
    const ids = new Set(rows.map((r) => r.id));
    return new Set([...selected].filter((id) => ids.has(id)));
  }, [rows, selected]);

  const columns = useMemo<Column<SaleRow>[]>(() => [
    { key: 'sale_date', label: '납품일', width: 104 },
    { key: 'kind', label: '구분', width: 92, filter: true, value: (r) => SALE_KIND[r.kind] ?? r.kind,
      render: (r) => <Badge cls={KIND_CLS[r.kind] ?? KIND_CLS.sale}>{SALE_KIND[r.kind] ?? r.kind}</Badge> },
    { key: 'customer', label: '거래처', width: 160, filter: true },
    { key: 'product_name', label: '제품', width: 150 },
    { key: 'model', label: '모델', width: 120 },
    { key: 'manager', label: '담당자', width: 90, filter: true },
    { key: 'quantity', label: '수량', width: 84, align: 'right', render: (r) => <span className={neg(r.quantity)}>{fmtNum(r.quantity, 4)}</span> },
    { key: 'unit', label: '단위', width: 64 },
    { key: 'unit_price', label: '단가', width: 112, align: 'right', render: (r) => fmtNum(r.unit_price, 4) },
    { key: 'currency', label: '통화', width: 64 },
    { key: 'exchange_rate', label: '환율', width: 84, align: 'right', render: (r) => fmtNum(r.exchange_rate, 4) },
    { key: 'supply_amount', label: '공급가액', width: 124, align: 'right', render: (r) => <span className={neg(r.supply_amount)}>{fmtNum(r.supply_amount, 2)}</span> },
    { key: 'vat_amount', label: '부가세액', width: 112, align: 'right', render: (r) => <span className={neg(r.vat_amount)}>{fmtNum(r.vat_amount, 2)}</span> },
    { key: 'total_amount', label: '총금액', width: 132, align: 'right', render: (r) => <strong className={neg(r.total_amount) ?? 'text-slate-900'}>{fmtNum(r.total_amount, 2)}</strong> },
    { key: 'is_edited', label: '수정', width: 78, align: 'center', value: (r) => (r.is_edited ? '수정됨' : ''),
      render: (r) => (r.is_edited ? <Badge cls="bg-amber-50 text-amber-800 ring-amber-300" title="가져오거나 입력한 뒤 수정된 거래">수정됨</Badge> : null) },
  ], []);

  const refresh = () => router.refresh();

  const bulkDelete = async () => {
    const ids = [...liveSelected];
    if (!ids.length) return;
    if (!window.confirm(`선택한 ${ids.length}건을 삭제할까요?\n삭제한 거래는 되돌릴 수 없습니다. (Excel 파일을 다시 가져오면 재등록할 수 있습니다)`)) return;
    setBusy(true);
    try {
      const res = await api<{ deleted: number }>('POST', '/api/admin/sales/bulk-delete', { ids });
      toast(`${res.deleted}건을 삭제했습니다.`);
      setSelected(new Set());
      refresh();
    } catch (e) {
      toast((e as Error).message, 'err');
      refresh();
    } finally { setBusy(false); }
  };

  const closing = async (action: 'confirm' | 'clear') => {
    const msg = action === 'confirm'
      ? `${year}년 ${month}월을 "매출 없음(0원)"으로 확정할까요?\n확정하면 그래프와 집계에 미등록이 아닌 0원으로 표시됩니다.`
      : `${year}년 ${month}월의 0원 확정을 해제할까요?\n해제하면 다시 미등록으로 표시됩니다.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await api('POST', '/api/admin/sales/closing', { year, month, action });
      toast(action === 'confirm' ? '0원으로 확정했습니다.' : '확정을 해제했습니다.');
      refresh();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };

  const tile = 'rounded-md border border-slate-200 bg-white px-3.5 py-2.5';
  const tileLabel = 'text-xs text-slate-500';
  const tileValue = 'mt-0.5 whitespace-nowrap text-base font-semibold tabular-nums text-slate-900';
  const money = (v: number | null) => (v === null ? <span className="text-amber-700">미등록</span> : fmtWon(v));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <YearMonthNav year={year} month={month} />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setImportOpen(true)}>Excel 가져오기</Button>
          <Button variant="primary" onClick={() => setEditing('new')}>거래 추가</Button>
        </div>
      </div>

      <section aria-label={`${year}년 ${month}월 매출 요약`} className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <div className={tile}>
          <div className={tileLabel}>상태</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <MonthState m={summary} />
            {summary.count === 0 && !summary.zeroConfirmed && <Button size="sm" disabled={busy} onClick={() => closing('confirm')}>매출 없음(0원)으로 확정</Button>}
            {summary.zeroConfirmed && <Button size="sm" disabled={busy} onClick={() => closing('clear')}>확정 해제</Button>}
          </div>
        </div>
        <div className={tile}><div className={tileLabel}>건수</div><div className={tileValue}>{summary.registered ? `${fmtNum(summary.count)}건` : <span className="text-amber-700">미등록</span>}</div></div>
        <div className={tile}><div className={tileLabel}>공급가액</div><div className={tileValue}>{money(summary.supply)}</div></div>
        <div className={tile}><div className={tileLabel}>부가세액</div><div className={tileValue}>{money(summary.vat)}</div></div>
        <div className={`${tile} border-blue-200 bg-blue-50/60`}><div className={tileLabel}>총금액 (부가세 포함)</div><div className={`${tileValue} text-blue-900`}>{money(summary.total)}</div></div>
        <div className={tile}><div className={tileLabel}>단위별 수량</div><div className={`${tileValue} !text-sm`} title="운임 등 단위·수량이 없는 거래는 제외">{fmtUnitQty(summary.qty)}</div></div>
      </section>
      {!summary.registered && (
        <p className="text-sm text-amber-800">
          이 달은 매출 자료가 등록되지 않았습니다(미등록). 실제로 매출이 없는 달이면 &quot;매출 없음(0원)으로 확정&quot;을 눌러 0원으로 기록해 주세요.
        </p>
      )}

      <Card title={`${year}년 ${month}월 개별 매출내역`}>
        <DataTable<SaleRow>
          id="sales-list"
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          pageSize={20}
          searchPlaceholder="거래처·제품·모델 등 검색"
          initialSort={{ key: 'sale_date', dir: 'asc' }}
          empty={summary.zeroConfirmed ? '매출 없음(0원)으로 확정된 달입니다.' : '등록된 거래가 없습니다. Excel 가져오기 또는 거래 추가로 등록해 주세요.'}
          onRowClick={(r) => setEditing(r)}
          selectable
          selected={liveSelected}
          onSelectedChange={setSelected}
          toolbar={<Button size="sm" variant="danger" disabled={busy || liveSelected.size === 0} onClick={bulkDelete}>선택 삭제{liveSelected.size > 0 ? ` (${liveSelected.size}건)` : ''}</Button>}
        />
        <p className="mt-2 text-xs text-slate-500">행을 누르면 상세 내용을 보고 수정할 수 있습니다. 반품은 음수(-)로 저장되어 합계에서 차감됩니다.</p>
      </Card>

      {editing && (
        <SaleFormModal
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`}
          sale={editing === 'new' ? null : editing}
          defaultDate={`${year}-${String(month).padStart(2, '0')}-01`}
          onClose={() => setEditing(null)}
          onSaved={(date) => {
            setEditing(null);
            const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
            if (y !== year || m !== month) router.push(`/admin/sales?year=${y}&month=${m}&tab=list`);
            refresh();
          }}
          onStale={() => { setEditing(null); refresh(); }}
        />
      )}
      {importOpen && (
        <SalesImportModal
          onClose={() => setImportOpen(false)}
          onSaved={(firstMonth) => {
            setImportOpen(false);
            const y = Number(firstMonth.slice(0, 4)), m = Number(firstMonth.slice(5, 7));
            if (y !== year || m !== month) router.push(`/admin/sales?year=${y}&month=${m}&tab=list`);
            refresh();
          }}
        />
      )}
    </div>
  );
}
