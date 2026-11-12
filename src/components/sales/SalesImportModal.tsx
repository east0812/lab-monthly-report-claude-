'use client';
// Excel 가져오기: 파일 선택 → 미리보기(저장 안 함) → 월 선택 → 선택한 월만 저장
import { useState } from 'react';
import { api, Badge, Button, Modal, useToast } from '@/components/ui';
import { SALE_KIND, fmtNum } from '@/lib/constants';
import { fmtUnitQty } from '@/lib/sales-data';
import type { ImportMonth, ImportRowError, ImportSheet, ParsedSale } from '@/lib/sales-import';
import { KIND_CLS } from './parts';

type Preview = {
  fileName: string;
  sheets: ImportSheet[];
  months: (ImportMonth & { newCount: number; dupCount: number })[];
  errors: ImportRowError[];
  warnings: string[];
  skipped: { empty: number; summary: number };
  totalRows: number;
  rows: (Omit<ParsedSale, 'import_key'> & { isNew: boolean })[];
  truncated: boolean;
};
type SaveResult = { inserted: number; skipped: number; months: string[] };

const MAX_BYTES = 10 * 1024 * 1024;
const th = 'border-b border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600 whitespace-nowrap';
const td = 'border-b border-slate-100 px-2.5 py-1.5 text-sm text-slate-800 whitespace-nowrap';
const num = `${td} text-right tabular-nums`;
const monthLabel = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;

export function SalesImportModal({ onClose, onSaved }: { onClose: () => void; onSaved: (firstMonth: string) => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [error, setError] = useState('');

  const choose = async (f: File | null) => {
    setPreview(null); setPicked(new Set()); setError(''); setFile(f);
    if (!f) return;
    if (!/\.(xlsx|xls)$/i.test(f.name)) return setError('Excel 파일(.xls, .xlsx)만 가져올 수 있습니다.');
    if (f.size > MAX_BYTES) return setError('파일이 너무 큽니다. 10MB 이하의 Excel 파일만 올릴 수 있습니다.');
    setBusy('preview');
    try {
      const fd = new FormData();
      fd.append('file', f);
      const p = await api<Preview>('POST', '/api/admin/sales/import', fd);
      setPreview(p);
      setPicked(new Set(p.months.filter((m) => m.newCount > 0).map((m) => m.month)));
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const save = async () => {
    if (!file || !preview || picked.size === 0) return;
    const months = [...picked].sort();
    setBusy('save');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('months', months.join(','));
      const r = await api<SaveResult>('POST', '/api/admin/sales/import', fd);
      toast(`${fmtNum(r.inserted)}건을 등록했습니다.${r.skipped > 0 ? ` 이미 등록된 ${fmtNum(r.skipped)}건은 건너뛰었습니다.` : ''}`);
      onSaved(months[0]);
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  };

  const toggle = (m: string) => setPicked((p) => { const s = new Set(p); if (s.has(m)) s.delete(m); else s.add(m); return s; });
  const pickedNew = preview ? preview.months.filter((m) => picked.has(m.month)).reduce((a, m) => a + m.newCount, 0) : 0;

  return (
    <Modal open onClose={busy ? () => {} : onClose} wide title="판매내역 Excel 가져오기"
      footer={<>
        <Button onClick={onClose} disabled={!!busy}>닫기</Button>
        <Button variant="primary" onClick={save} disabled={!!busy || !preview || picked.size === 0}>
          {busy === 'save' ? '저장 중…' : preview && picked.size > 0 ? `선택한 ${picked.size}개월 저장 (신규 ${fmtNum(pickedNew)}건)` : '선택한 월 저장'}
        </Button>
      </>}>
      <div className="space-y-4">
        <div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Excel 파일 (.xls, .xlsx · 10MB 이하)</span>
            <input type="file" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={!!busy} onChange={(e) => choose(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-700 file:mr-3 file:h-9 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50" />
          </label>
          <p className="mt-1.5 text-xs text-slate-500">
            파일을 고르면 먼저 미리보기만 보여 줍니다. &quot;저장&quot;을 누르기 전에는 아무것도 저장되지 않습니다.
            이미 등록된 거래는 건너뛰므로(수정한 값 유지) 같은 파일을 다시 올려도 중복되지 않습니다.
          </p>
        </div>

        {busy === 'preview' && <p role="status" className="text-sm text-slate-600">파일을 읽는 중입니다…</p>}
        {error && <p role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>}

        {preview && (
          <>
            <p className="text-sm text-slate-700">
              <strong>{preview.fileName}</strong> — 가져올 수 있는 거래 <strong>{fmtNum(preview.totalRows)}건</strong>
              {preview.errors.length > 0 && <>, <span className="font-semibold text-rose-700">오류 {fmtNum(preview.errors.length)}행 제외</span></>}
              {(preview.skipped.empty > 0 || preview.skipped.summary > 0) && (
                <span className="text-slate-500"> (빈 행 {fmtNum(preview.skipped.empty)}개, 합계·소계 행 {fmtNum(preview.skipped.summary)}개는 건너뜀)</span>
              )}
            </p>
            {preview.warnings.map((w, i) => <p key={i} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{w}</p>)}

            {preview.months.length > 0 ? (
              <div>
                <h3 className="mb-1.5 text-sm font-semibold text-slate-800">저장할 월 선택</h3>
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th scope="col" className={`${th} w-10 text-center`}>저장</th>
                        <th scope="col" className={`${th} text-left`}>월</th>
                        <th scope="col" className={`${th} text-right`}>건수</th>
                        <th scope="col" className={`${th} text-right`}>신규</th>
                        <th scope="col" className={`${th} text-right`}>이미 등록됨(중복)</th>
                        <th scope="col" className={`${th} text-left`}>단위별 수량</th>
                        <th scope="col" className={`${th} text-right`}>공급가액</th>
                        <th scope="col" className={`${th} text-right`}>부가세액</th>
                        <th scope="col" className={`${th} text-right`}>총금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.months.map((m) => (
                        <tr key={m.month} className={picked.has(m.month) ? 'bg-blue-50/60' : undefined}>
                          <td className={`${td} text-center`}>
                            <input type="checkbox" aria-label={`${monthLabel(m.month)} 저장`} checked={picked.has(m.month)} disabled={!!busy} onChange={() => toggle(m.month)} />
                          </td>
                          <td className={`${td} font-medium`}>{monthLabel(m.month)}</td>
                          <td className={num}>{fmtNum(m.count)}</td>
                          <td className={`${num} font-semibold text-blue-800`}>{fmtNum(m.newCount)}</td>
                          <td className={`${num} ${m.dupCount > 0 ? 'text-slate-500' : 'text-slate-300'}`}>{fmtNum(m.dupCount)}</td>
                          <td className={td}>{fmtUnitQty(m.qty)}</td>
                          <td className={num}>{fmtNum(m.supply, 2)}</td>
                          <td className={num}>{fmtNum(m.vat, 2)}</td>
                          <td className={`${num} font-semibold`}>{fmtNum(m.total, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">신규 거래가 있는 월이 기본으로 선택됩니다. 선택한 월은 한 번에 저장되며, 도중에 문제가 생기면 전부 취소됩니다.</p>
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">가져올 수 있는 거래가 없습니다.</p>
            )}

            {preview.errors.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-sm font-semibold text-rose-800">가져오지 않는 행 (오류 {fmtNum(preview.errors.length)}건)</h3>
                <div className="max-h-48 overflow-auto rounded-md border border-rose-200">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th scope="col" className={`${th} text-left`}>시트</th>
                        <th scope="col" className={`${th} text-right`}>행 번호</th>
                        <th scope="col" className={`${th} text-left`}>사유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.errors.map((e, i) => (
                        <tr key={i}>
                          <td className={td}>{e.sheet}</td>
                          <td className={num}>{e.row}</td>
                          <td className={`${td} !whitespace-normal`}>{e.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">Excel 파일에서 해당 행을 고친 뒤 다시 올리면 그 행만 새로 등록됩니다.</p>
              </div>
            )}

            {preview.rows.length > 0 && (
              <details className="rounded-md border border-slate-200">
                <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  행 미리보기 ({fmtNum(preview.rows.length)}건{preview.truncated ? ` · 전체 ${fmtNum(preview.totalRows)}건 중 앞부분` : ''})
                </summary>
                <div className="max-h-80 overflow-auto border-t border-slate-200">
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0">
                      <tr>
                        <th scope="col" className={`${th} text-left`}>시트 / 행</th>
                        <th scope="col" className={`${th} text-left`}>납품일</th>
                        <th scope="col" className={`${th} text-left`}>구분</th>
                        <th scope="col" className={`${th} text-left`}>거래처</th>
                        <th scope="col" className={`${th} text-left`}>제품</th>
                        <th scope="col" className={`${th} text-right`}>수량</th>
                        <th scope="col" className={`${th} text-right`}>단가</th>
                        <th scope="col" className={`${th} text-right`}>공급가액</th>
                        <th scope="col" className={`${th} text-right`}>부가세액</th>
                        <th scope="col" className={`${th} text-right`}>총금액</th>
                        <th scope="col" className={`${th} text-left`}>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r) => (
                        <tr key={`${r.sheet}:${r.row}`} className={picked.has(r.month) ? undefined : 'opacity-50'}>
                          <td className={`${td} text-slate-500`}>{r.sheet} / {r.row}</td>
                          <td className={td}>{r.sale_date}</td>
                          <td className={td}><Badge cls={KIND_CLS[r.kind]}>{SALE_KIND[r.kind]}</Badge></td>
                          <td className={td}>{r.customer}</td>
                          <td className={td}>{r.product_name}{r.model ? ` (${r.model})` : ''}</td>
                          <td className={num}>{r.quantity === null ? '' : `${fmtNum(r.quantity, 4)} ${r.unit}`}</td>
                          <td className={num}>{r.unit_price === null ? '' : `${fmtNum(r.unit_price, 4)}${r.currency !== 'KRW' ? ` ${r.currency}` : ''}`}</td>
                          <td className={`${num} ${r.supply_amount < 0 ? 'text-rose-700' : ''}`}>{fmtNum(r.supply_amount, 2)}</td>
                          <td className={`${num} ${r.vat_amount < 0 ? 'text-rose-700' : ''}`}>{fmtNum(r.vat_amount, 2)}</td>
                          <td className={`${num} font-semibold ${r.total_amount < 0 ? 'text-rose-700' : ''}`}>{fmtNum(r.total_amount, 2)}</td>
                          <td className={td}>{r.isNew ? <Badge cls="bg-blue-100 text-blue-800 ring-blue-300">신규</Badge> : <Badge cls="bg-slate-100 text-slate-600 ring-slate-300">이미 등록됨</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
