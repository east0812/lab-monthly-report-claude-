'use client';
// 시스템 설정: 연구소 이름, 관리자 문의 방법, 첨부 최대 크기 + 환경 설정 상태(읽기 전용)
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, Badge, Button, Card, Field, Input, PageHeader, Textarea, useToast } from '../ui';

export type Settings = { lab_name: string; admin_contact: string; attachment_max_mb: number };
export type EnvStatus = { email_reset_enabled: boolean; app_base_url_set: boolean; attachment_dir_set: boolean };

export function SettingsForm({ settings, status }: { settings: Settings; status: EnvStatus }) {
  const router = useRouter();
  const toast = useToast();
  const [labName, setLabName] = useState(settings.lab_name);
  const [contact, setContact] = useState(settings.admin_contact);
  const [maxMb, setMaxMb] = useState(String(settings.attachment_max_mb));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dirty = labName !== settings.lab_name || contact !== settings.admin_contact || maxMb !== String(settings.attachment_max_mb);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const mb = Number(maxMb);
    if (!Number.isInteger(mb) || mb < 1 || mb > 200) { setErr('첨부 최대 크기는 1~200 사이의 정수(MB)로 입력해 주세요.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api<{ settings: Settings }>('PUT', '/api/admin/settings', { lab_name: labName, admin_contact: contact, attachment_max_mb: mb });
      setLabName(r.settings.lab_name); setContact(r.settings.admin_contact); setMaxMb(String(r.settings.attachment_max_mb));
      toast('설정을 저장했습니다.');
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div>
      <PageHeader title="시스템 설정" desc="사이트 이름과 로그인 화면 안내, 첨부 파일 크기 제한을 관리합니다." />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="기본 설정" className="xl:col-span-2">
          <form onSubmit={submit} className="max-w-2xl space-y-4">
            {err && <div role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{err}</div>}
            <Field label="연구소 이름" required hint="왼쪽 메뉴 상단과 로그인 화면에 표시됩니다. (예: ○○연구소)">
              <Input required maxLength={50} value={labName} onChange={(e) => setLabName(e.target.value)} />
            </Field>
            <Field label="관리자 문의 방법" hint="로그인 화면의 「비밀번호를 잊으셨나요?」에 표시됩니다. 담당자 이름·내선번호 등을 적어 주세요. (로그인하지 않은 사람도 볼 수 있습니다)">
              <Textarea rows={4} maxLength={1000} value={contact} onChange={(e) => setContact(e.target.value)} />
            </Field>
            <Field label="첨부 최대 크기 (MB)" hint="월차보고 첨부 파일 1개의 최대 크기입니다. 1~200 사이의 정수." className="max-w-56">
              <Input type="number" required min={1} max={200} step={1} value={maxMb} onChange={(e) => setMaxMb(e.target.value)} />
            </Field>
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" disabled={busy || !dirty}>{busy ? '저장 중…' : '저장'}</Button>
              {!dirty && <span className="text-xs text-slate-500">변경된 내용이 없습니다.</span>}
            </div>
          </form>
        </Card>

        <Card title="환경 설정 상태">
          <p className="mb-3 text-xs leading-relaxed text-slate-500">서버 환경변수(.env)로 정하는 항목입니다. 이 화면에서는 바꿀 수 없으며, 보안을 위해 설정 여부만 표시합니다.</p>
          <dl className="space-y-3 text-sm">
            <StatusRow label="이메일 비밀번호 재설정" on={status.email_reset_enabled} onText="사용" offText="사용 안 함"
              desc={status.email_reset_enabled ? '직원이 로그인 화면에서 재설정 메일을 받을 수 있습니다.' : '비밀번호는 [직원 관리]에서 관리자가 재설정합니다.'} />
            <StatusRow label="사이트 주소 (APP_BASE_URL)" on={status.app_base_url_set} onText="설정됨" offText="설정 안 됨"
              desc="비밀번호 재설정 메일의 링크 주소에 사용합니다." />
            <StatusRow label="첨부 저장 폴더" on={status.attachment_dir_set} onText="설정됨" offText="기본값 사용"
              desc={status.attachment_dir_set ? '지정한 폴더에 첨부 파일을 저장합니다.' : '서버의 기본 폴더에 첨부 파일을 저장합니다.'} />
          </dl>
        </Card>
      </div>
    </div>
  );
}

function StatusRow({ label, on, onText, offText, desc }: { label: string; on: boolean; onText: string; offText: string; desc: string }) {
  return (
    <div className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
      <dt className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-800">{label}</span>
        <Badge cls={on ? 'bg-emerald-100 text-emerald-800 ring-emerald-300' : 'bg-slate-100 text-slate-700 ring-slate-300'}>{on ? onText : offText}</Badge>
      </dt>
      <dd className="mt-1 text-xs leading-relaxed text-slate-500">{desc}</dd>
    </div>
  );
}
