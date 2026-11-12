'use client';
// 내 정보: 이름 변경, 비밀번호 변경
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, Badge, Button, Card, Field, Input, PageHeader, useToast } from '@/components/ui';
import type { Role } from '@/lib/constants';

const SELF_PW_MIN = 12;

function ErrorLine({ msg }: { msg: string }) {
  return msg ? <div role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{msg}</div> : null;
}

export function MeForms({ me }: { me: { email: string; name: string; role: Role } }) {
  return (
    <div>
      <PageHeader title="내 정보" desc="이름과 비밀번호를 바꿀 수 있습니다. 이메일과 역할은 관리자만 변경할 수 있습니다." />
      <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title="계정">
            <dl className="grid grid-cols-[5rem_1fr] gap-y-2.5 text-sm">
              <dt className="text-slate-500">이메일</dt>
              <dd className="break-all text-slate-900">{me.email}</dd>
              <dt className="text-slate-500">역할</dt>
              <dd><Badge cls={me.role === 'admin' ? 'bg-indigo-100 text-indigo-800 ring-indigo-300' : 'bg-slate-100 text-slate-700 ring-slate-300'}>{me.role === 'admin' ? '관리자' : '직원'}</Badge></dd>
            </dl>
          </Card>
          <NameForm name={me.name} />
        </div>
        <PasswordForm email={me.email} />
      </div>
    </div>
  );
}

function NameForm({ name: initial }: { name: string }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api<{ me: { name: string } }>('PATCH', '/api/me', { name });
      setName(r.me.name);
      toast('이름을 변경했습니다.');
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <Card title="이름 변경">
      <form onSubmit={submit} className="space-y-3">
        <ErrorLine msg={err} />
        <Field label="이름" required hint="보고서와 업무 기록의 담당자 이름으로 표시됩니다.">
          <Input required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Button type="submit" variant="primary" disabled={busy || !name.trim() || name.trim() === initial}>{busy ? '저장 중…' : '이름 저장'}</Button>
      </form>
    </Card>
  );
}

function PasswordForm({ email }: { email: string }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < SELF_PW_MIN) { setErr(`새 비밀번호는 ${SELF_PW_MIN}자 이상이어야 합니다.`); return; }
    if (password !== confirm) { setErr('비밀번호 확인이 일치하지 않습니다.'); return; }
    if (password === current) { setErr('이전과 다른 비밀번호를 입력해 주세요.'); return; }
    setBusy(true); setErr('');
    try {
      await api('POST', '/api/me/password', { current, password, confirm });
      setCurrent(''); setPassword(''); setConfirm('');
      toast('비밀번호를 변경했습니다. 다음 로그인부터 새 비밀번호를 사용해 주세요.');
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <Card title="비밀번호 변경">
      <form onSubmit={submit} className="space-y-3">
        <ErrorLine msg={err} />
        {/* 비밀번호 관리자가 계정을 올바르게 인식하도록 이메일을 함께 둔다 */}
        <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
        <Field label="현재 비밀번호" required>
          <Input type="password" required maxLength={72} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="새 비밀번호" required hint={`${SELF_PW_MIN}자 이상. 다른 사이트에서 쓰지 않는 비밀번호를 권장합니다.`}>
          <Input type="password" required minLength={SELF_PW_MIN} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="새 비밀번호 확인" required>
          <Input type="password" required maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? '변경 중…' : '비밀번호 변경'}</Button>
        <p className="text-xs leading-relaxed text-slate-500">변경하면 이 기기는 로그인 상태가 유지되고, 다른 기기에 남아 있는 로그인은 종료됩니다. 현재 비밀번호를 모르면 관리자에게 재설정을 요청해 주세요.</p>
      </form>
    </Card>
  );
}
