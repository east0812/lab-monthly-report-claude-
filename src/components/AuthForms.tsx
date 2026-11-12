'use client';
// 로그인 / 비밀번호 찾기 / 새 비밀번호 설정 폼
import Link from 'next/link';
import { useState } from 'react';
import { api, Button, Field, Input } from './ui';

function Alert({ kind, children }: { kind: 'err' | 'ok' | 'info'; children: React.ReactNode }) {
  const cls = { err: 'border-rose-300 bg-rose-50 text-rose-900', ok: 'border-emerald-300 bg-emerald-50 text-emerald-900', info: 'border-blue-200 bg-blue-50 text-blue-900' }[kind];
  return <div role={kind === 'err' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2.5 text-sm leading-relaxed ${cls}`}>{children}</div>;
}

export function AuthCard({ title, labName, children }: { title: string; labName: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-50 to-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-[#0f3d8c] text-lg font-bold text-white">月</div>
          <div className="text-lg font-bold text-slate-900">{labName || '연구소'} 월차보고</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="mb-4 text-base font-semibold text-slate-900">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api('POST', '/api/auth/login', { email, password, remember });
      location.href = next;
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {notice && <Alert kind="ok">{notice}</Alert>}
      {err && <Alert kind="err">{err}</Alert>}
      <Field label="이메일"><Input type="email" name="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="비밀번호"><Input type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <div className="flex items-center justify-between text-sm">
        <label className="inline-flex items-center gap-2 text-slate-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 로그인 유지
        </label>
        <Link href="/forgot-password" className="text-blue-700 hover:underline">비밀번호를 잊으셨나요?</Link>
      </div>
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</Button>
    </form>
  );
}

export function ForgotForm({ enabled, contact, expired }: { enabled: boolean; contact: string; expired: boolean }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await api('POST', '/api/auth/forgot', { email });
      setMsg({ kind: 'ok', text: '등록된 이메일이라면 재설정 링크를 보냈습니다. 메일함을 확인해 주세요. 링크는 한 번만 사용할 수 있습니다.' });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    }
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      {expired && <Alert kind="err">재설정 링크가 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요.</Alert>}
      <Alert kind="info">
        <div className="font-medium">관리자에게 요청하기</div>
        <div className="mt-1 whitespace-pre-wrap">{contact || '연구소 관리자에게 비밀번호 재설정을 요청해 주세요.'}</div>
        <div className="mt-1 text-xs text-blue-800">관리자는 [직원 관리 → 해당 직원의 비밀번호 재설정]에서 새 비밀번호를 발급할 수 있습니다.</div>
      </Alert>
      {enabled ? (
        <form onSubmit={submit} className="space-y-3 border-t border-slate-200 pt-4">
          <div className="text-sm font-medium text-slate-800">이메일로 직접 재설정</div>
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <Field label="가입 이메일"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></Field>
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? '보내는 중…' : '재설정 링크 보내기'}</Button>
        </form>
      ) : (
        <p className="border-t border-slate-200 pt-3 text-xs text-slate-500">이메일 재설정 기능은 아직 설정되지 않았습니다. 위 방법으로 관리자에게 문의해 주세요.</p>
      )}
      <Link href="/login" className="block text-center text-sm text-blue-700 hover:underline">로그인 화면으로</Link>
    </div>
  );
}

export function ResetForm() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api('POST', '/api/auth/reset', { password, confirm });
      location.href = '/login?reset=1';
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {err && <Alert kind="err">{err}</Alert>}
      <Field label="새 비밀번호" hint="12자 이상"><Input type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Field label="새 비밀번호 확인"><Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? '저장 중…' : '비밀번호 저장'}</Button>
    </form>
  );
}
