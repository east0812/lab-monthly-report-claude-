'use client';
// 직원 관리: 목록, 등록, 수정, 비밀번호 재설정
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, useToast } from '../ui';
import { DataTable, type Column } from '../DataTable';
import { fmtDateTime, type Role } from '@/lib/constants';

export type UserRow = { id: string; email: string; name: string; role: Role; is_active: boolean; created_at: string };

const ROLE_LABEL: Record<Role, string> = { employee: '직원', admin: '관리자' };
const ADMIN_PW_MIN = 6;

type Dialog = { type: 'create' } | { type: 'edit'; user: UserRow } | { type: 'password'; user: UserRow } | null;

export function UsersManager({ users, meId }: { users: UserRow[]; meId: string }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);

  const columns: Column<UserRow>[] = [
    { key: 'name', label: '이름', width: 130, render: (u) => <span className="font-medium">{u.name}{u.id === meId && <span className="ml-1 text-xs font-normal text-slate-500">(나)</span>}</span> },
    { key: 'email', label: '이메일', width: 220 },
    { key: 'role', label: '역할', width: 100, filter: true, value: (u) => ROLE_LABEL[u.role],
      render: (u) => <Badge cls={u.role === 'admin' ? 'bg-indigo-100 text-indigo-800 ring-indigo-300' : 'bg-slate-100 text-slate-700 ring-slate-300'}>{ROLE_LABEL[u.role]}</Badge> },
    { key: 'is_active', label: '상태', width: 100, filter: true, value: (u) => (u.is_active ? '활성' : '비활성'),
      render: (u) => <Badge cls={u.is_active ? 'bg-emerald-100 text-emerald-800 ring-emerald-300' : 'bg-rose-100 text-rose-800 ring-rose-300'}>{u.is_active ? '활성' : '비활성'}</Badge> },
    { key: 'created_at', label: '등록일', width: 150, value: (u) => fmtDateTime(u.created_at) },
    { key: 'actions', label: '관리', width: 200, sortable: false, value: () => '',
      render: (u) => (
        <span className="inline-flex gap-1.5">
          <Button size="sm" onClick={() => setDialog({ type: 'edit', user: u })}>수정</Button>
          <Button size="sm" onClick={() => setDialog({ type: 'password', user: u })}>비밀번호 재설정</Button>
        </span>
      ) },
  ];

  return (
    <div>
      <PageHeader title="직원 관리" desc="직원 계정을 등록하고 역할·활성 상태를 관리합니다. 비활성 계정은 로그인할 수 없습니다."
        actions={<Button variant="primary" onClick={() => setDialog({ type: 'create' })}>직원 등록</Button>} />
      <Card>
        <DataTable id="users" rows={users} columns={columns} rowKey={(u) => u.id} searchPlaceholder="이름·이메일 검색" empty="등록된 직원이 없습니다." />
      </Card>
      {dialog?.type === 'create' && <CreateDialog onClose={close} />}
      {dialog?.type === 'edit' && <EditDialog user={dialog.user} isSelf={dialog.user.id === meId} onClose={close} />}
      {dialog?.type === 'password' && <PasswordDialog user={dialog.user} onClose={close} />}
    </div>
  );
}

function checkPassword(pw: string, confirm: string): string | null {
  if (pw.length < ADMIN_PW_MIN) return `비밀번호는 ${ADMIN_PW_MIN}자 이상이어야 합니다.`;
  if (pw !== confirm) return '비밀번호 확인이 일치하지 않습니다.';
  return null;
}

function ErrorLine({ msg }: { msg: string }) {
  return msg ? <div role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{msg}</div> : null;
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('employee');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const bad = checkPassword(password, confirm);
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr('');
    try {
      await api('POST', '/api/admin/users', { email, name, role, password, confirm });
      toast('직원을 등록했습니다. 초기 비밀번호는 직원에게 직접 전달해 주세요.');
      onClose();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="직원 등록"
      footer={<><Button onClick={onClose} disabled={busy}>취소</Button><Button variant="primary" type="submit" form="user-create-form" disabled={busy}>{busy ? '등록 중…' : '등록'}</Button></>}>
      <form id="user-create-form" onSubmit={submit} className="space-y-3" autoComplete="off">
        <ErrorLine msg={err} />
        <Field label="이메일" required hint="로그인에 사용하는 주소입니다."><Input type="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="이름" required><Input required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
          <Field label="역할" required>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="employee">직원</option>
              <option value="admin">관리자</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="초기 비밀번호" required hint={`${ADMIN_PW_MIN}자 이상`}><Input type="password" required minLength={ADMIN_PW_MIN} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="초기 비밀번호 확인" required><Input type="password" required maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
        </div>
        <p className="text-xs text-slate-500">초기 비밀번호는 화면이나 알림에 다시 표시되지 않습니다. 직원에게 직접 전달하고, 로그인 후 [내 정보]에서 바꾸도록 안내해 주세요.</p>
      </form>
    </Modal>
  );
}

function EditDialog({ user, isSelf, onClose }: { user: UserRow; isSelf: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [active, setActive] = useState(user.is_active);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const body: Record<string, unknown> = { name };
      if (!isSelf) { body.role = role; body.is_active = active; }
      const r = await api<{ auth_synced?: boolean }>('PATCH', `/api/admin/users/${user.id}`, body);
      if (r.auth_synced === false) toast('저장했습니다. 다만 인증 서버의 계정 잠금 상태는 바꾸지 못했습니다. (로그인 차단은 정상 적용됩니다)', 'err');
      else toast(active !== user.is_active ? (active ? '계정을 다시 활성화했습니다.' : '계정을 비활성화했습니다. 이 직원은 더 이상 로그인할 수 없습니다.') : '저장했습니다.');
      onClose();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="직원 정보 수정"
      footer={<><Button onClick={onClose} disabled={busy}>취소</Button><Button variant="primary" type="submit" form="user-edit-form" disabled={busy}>{busy ? '저장 중…' : '저장'}</Button></>}>
      <form id="user-edit-form" onSubmit={submit} className="space-y-3">
        <ErrorLine msg={err} />
        <Field label="이메일"><Input value={user.email} disabled readOnly /></Field>
        <Field label="이름" required><Input required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="역할">
            <Select value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="employee">직원</option>
              <option value="admin">관리자</option>
            </Select>
          </Field>
          <Field label="활성 상태">
            <Select value={active ? '1' : '0'} disabled={isSelf} onChange={(e) => setActive(e.target.value === '1')}>
              <option value="1">활성</option>
              <option value="0">비활성 (로그인 차단)</option>
            </Select>
          </Field>
        </div>
        {isSelf
          ? <p className="text-xs text-slate-500">본인의 역할과 활성 상태는 변경할 수 없습니다. 필요하면 다른 관리자에게 요청해 주세요.</p>
          : <p className="text-xs text-slate-500">비활성화해도 이 직원이 작성한 보고서와 업무 기록은 그대로 보존됩니다.</p>}
      </form>
    </Modal>
  );
}

function PasswordDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const bad = checkPassword(password, confirm);
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr('');
    try {
      await api('POST', `/api/admin/users/${user.id}/password`, { password, confirm });
      toast('비밀번호를 재설정했습니다. 직원에게 직접 전달해 주세요.');
      onClose();
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="비밀번호 재설정"
      footer={<><Button onClick={onClose} disabled={busy}>취소</Button><Button variant="primary" type="submit" form="user-password-form" disabled={busy}>{busy ? '저장 중…' : '재설정'}</Button></>}>
      <form id="user-password-form" onSubmit={submit} className="space-y-3" autoComplete="off">
        <ErrorLine msg={err} />
        <p className="text-sm text-slate-700"><span className="font-medium">{user.name}</span> ({user.email}) 계정의 비밀번호를 새로 정합니다.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="새 비밀번호" required hint={`${ADMIN_PW_MIN}자 이상`}><Input type="password" required minLength={ADMIN_PW_MIN} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus /></Field>
          <Field label="새 비밀번호 확인" required><Input type="password" required maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
        </div>
        <p className="text-xs text-slate-500">새 비밀번호는 저장 후 어디에도 표시되지 않습니다. 직원에게 직접 전달하고, 로그인 후 [내 정보]에서 12자 이상으로 바꾸도록 안내해 주세요.</p>
      </form>
    </Modal>
  );
}
