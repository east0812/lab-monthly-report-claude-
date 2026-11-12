-- =====================================================================
-- 연구소 월차보고 관리 사이트: 초기 스키마
-- 대상: Supabase PostgreSQL (auth 스키마, anon/authenticated/service_role 역할 존재 전제)
-- 적용: Supabase SQL Editor 에 붙여 넣거나 `npm run db:migrate`
-- 원칙: 모든 테이블에 RLS 적용. 상태 전이는 SECURITY DEFINER 함수로만 수행.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 기준 테이블
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  name        text not null check (length(btrim(name)) between 1 and 50),
  role        text not null default 'employee' check (role in ('employee','admin')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));

create table public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 100),
  model       text not null default '',
  family      text not null default '',   -- 제품군
  freq_band   text not null default '',   -- 주파수대역
  revision    text not null default '',
  note        text not null default '',
  deleted_at  timestamptz,                -- 삭제(복원 가능). 행은 남겨 기존 이력을 보존한다.
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index products_name_model_key on public.products (lower(name), lower(model)) where deleted_at is null;

create table public.product_revisions (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  revision    text not null,
  prev_revision text,
  changed_by  uuid references public.profiles(id) on delete set null,
  changed_at  timestamptz not null default now()
);
create index product_revisions_product_idx on public.product_revisions (product_id, changed_at);

create table public.work_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 50),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index work_categories_name_key on public.work_categories (lower(name));

create table public.app_settings (
  key         text primary key,
  value       text not null default '',
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. 월차보고
-- ---------------------------------------------------------------------
create table public.monthly_reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete restrict,
  year          integer not null check (year between 2000 and 2100),
  month         integer not null check (month between 1 and 12),
  status        text not null default 'draft'
                check (status in ('draft','submitted','reviewed','finalized','rejected')),
  summary       text not null default '',
  reject_reason text,
  submitted_at  timestamptz,
  reviewed_at   timestamptz,
  finalized_at  timestamptz,
  rejected_at   timestamptz,
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, year, month)
);
create index monthly_reports_period_idx on public.monthly_reports (year, month, status);

create table public.report_items (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.monthly_reports(id) on delete cascade,
  section     text not null check (section in ('sm_drawing','spec','education','purchase','machining')),
  sort_order  integer not null default 0,
  product_id  uuid references public.products(id) on delete restrict,
  category_id uuid references public.work_categories(id) on delete set null,
  title       text not null default '',
  revision    text not null default '',
  change_note text not null default '',   -- 변경 내용 (도면/사양서)
  content     text not null default '',
  item_name   text not null default '',   -- 품목 (구매/가공)
  vendor      text not null default '',   -- 업체
  quantity    numeric(18,4),
  unit        text not null default '',
  schedule    text not null default '',   -- 일정
  status      text not null default 'in_progress' check (status in ('done','in_progress','on_hold')),
  note        text not null default '',
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index report_items_report_idx on public.report_items (report_id, section, sort_order);
create index report_items_product_idx on public.report_items (product_id);

-- 개발과제: 기본 정보와 월별 진행률·결과를 분리
create table public.dev_projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete restrict,
  name        text not null check (length(btrim(name)) between 1 and 200),
  product_id  uuid references public.products(id) on delete restrict,
  category_id uuid references public.work_categories(id) on delete set null,
  goal        text not null default '',
  start_date  date,
  end_date    date,
  is_closed   boolean not null default false,
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index dev_projects_user_idx on public.dev_projects (user_id);

create table public.dev_project_monthly (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.dev_projects(id) on delete cascade,
  report_id   uuid not null references public.monthly_reports(id) on delete cascade,
  progress    integer not null default 0 check (progress between 0 and 100),
  status      text not null default 'in_progress' check (status in ('done','in_progress','on_hold')),
  result      text not null default '',
  issue       text not null default '',
  next_plan   text not null default '',
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, report_id)
);
create index dev_project_monthly_report_idx on public.dev_project_monthly (report_id);

create table public.report_status_history (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.monthly_reports(id) on delete cascade,
  from_status text,
  to_status   text not null,
  actor_id    uuid references public.profiles(id) on delete set null,
  reason      text,
  created_at  timestamptz not null default now()
);
create index report_status_history_report_idx on public.report_status_history (report_id, created_at);

create table public.report_attachments (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.monthly_reports(id) on delete cascade,
  file_name   text not null,              -- 사용자가 올린 원래 파일명
  stored_name text not null,              -- 서버 저장 파일명(무작위). 실제 경로는 서버 환경변수로만 결정
  mime_type   text not null default 'application/octet-stream',
  size_bytes  bigint not null check (size_bytes >= 0),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index report_attachments_report_idx on public.report_attachments (report_id);

-- ---------------------------------------------------------------------
-- 3. 개발현황 / 생산이관 (담당자·연·월 단위 기록)
-- ---------------------------------------------------------------------
create table public.dev_works (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete restrict, -- 담당자
  year          integer not null check (year between 2000 and 2100),
  month         integer not null check (month between 1 and 12),
  product_id    uuid not null references public.products(id) on delete restrict,
  revision      text not null default '',
  category_id   uuid references public.work_categories(id) on delete set null,
  title         text not null default '',
  status        text not null default 'in_progress'
                check (status in ('planned','in_progress','done','on_hold','stopped')),
  progress      integer not null default 0 check (progress between 0 and 100),
  work_done     text not null default '',   -- 수행내용
  test_result   text not null default '',   -- 시험결과
  issues        text not null default '',   -- 문제점
  actions       text not null default '',   -- 조치
  next_plan     text not null default '',   -- 차월계획
  carried_from_id uuid references public.dev_works(id) on delete set null, -- 전월 이월 원본
  version       integer not null default 1,
  updated_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index dev_works_period_idx on public.dev_works (year, month);
create index dev_works_user_idx on public.dev_works (user_id, year, month);
create index dev_works_product_idx on public.dev_works (product_id);
-- 같은 업무는 한 번만 이월할 수 있다.
create unique index dev_works_carried_from_key on public.dev_works (carried_from_id) where carried_from_id is not null;

create table public.transfers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete restrict, -- 담당자
  year            integer not null check (year between 2000 and 2100),
  month           integer not null check (month between 1 and 12),
  product_id      uuid not null references public.products(id) on delete restrict,
  dev_status      text not null default 'in_progress'
                  check (dev_status in ('planned','in_progress','done','on_hold','stopped')),
  transfer_status text not null default 'planned'
                  check (transfer_status in ('planned','in_progress','done','on_hold','stopped')),
  planned_date    date,
  completed_date  date,
  content         text not null default '',
  plan            text not null default '',
  version         integer not null default 1,
  updated_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index transfers_period_idx on public.transfers (year, month);
create index transfers_user_idx on public.transfers (user_id, year, month);
create index transfers_product_idx on public.transfers (product_id);

-- ---------------------------------------------------------------------
-- 4. 매출
-- ---------------------------------------------------------------------
create table public.sales_imports (
  id          uuid primary key default gen_random_uuid(),
  file_name   text not null,
  months      text not null default '',     -- 저장한 월 목록 (예: 2026-09,2026-10)
  inserted    integer not null default 0,
  skipped     integer not null default 0,   -- 중복으로 건너뛴 건수
  imported_by uuid references public.profiles(id) on delete set null,
  imported_at timestamptz not null default now()
);

create table public.sales (
  id            uuid primary key default gen_random_uuid(),
  sale_date     date not null,                                   -- 납품일
  year          integer generated always as (extract(year from sale_date)::integer) stored,
  month         integer generated always as (extract(month from sale_date)::integer) stored,
  kind          text not null default 'sale' check (kind in ('sale','return','freight','misc')),
  customer      text not null default '',                        -- 거래처
  product_name  text not null default '',
  model         text not null default '',
  manager       text not null default '',                        -- 담당자
  quantity      numeric(18,4),
  unit          text not null default '',
  unit_price    numeric(18,4),
  currency      text not null default 'KRW',
  exchange_rate numeric(18,6) not null default 1 check (exchange_rate > 0),
  supply_amount numeric(18,2) not null,                          -- 공급가액 (원화)
  vat_amount    numeric(18,2) not null default 0,                -- 부가세액 (원화)
  total_amount  numeric(18,2) not null,                          -- 총금액 = 부가세 포함 (원화)
  note          text not null default '',
  -- 가져오기 추적
  import_key    text unique,            -- 같은 거래 재등록 방지 키
  import_id     uuid references public.sales_imports(id) on delete set null,
  source_file   text,
  source_sheet  text,
  source_row    integer,
  orig_supply_amount numeric(18,2),     -- 원본 금액(가져온 시점)
  orig_vat_amount    numeric(18,2),
  orig_total_amount  numeric(18,2),
  is_edited     boolean not null default false,
  version       integer not null default 1,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- 운임·기타자재만 빈 수량/단가 허용
  constraint sales_qty_price_required
    check (kind in ('freight','misc') or (quantity is not null and unit_price is not null))
);
create index sales_period_idx on public.sales (year, month);
create index sales_date_idx on public.sales (sale_date);

-- 매출이 없는 달을 "실제 0원"으로 확정 (미등록과 구분)
create table public.sales_closings (
  year         integer not null check (year between 2000 and 2100),
  month        integer not null check (month between 1 and 12),
  note         text not null default '',
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  primary key (year, month)
);

-- ---------------------------------------------------------------------
-- 5. 알림
-- ---------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text not null default '',
  link        text not null default '',
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, is_read, created_at desc);

-- ---------------------------------------------------------------------
-- 6. 권한 판정 함수 (RLS 재귀를 피하기 위해 SECURITY DEFINER)
-- ---------------------------------------------------------------------
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.is_active and p.role = 'admin');
$$;

-- 다른 직원의 이름만 노출 (이메일·역할은 노출하지 않음)
create or replace function public.user_name(p_uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when public.is_active_user()
              then (select p.name from public.profiles p where p.id = p_uid) end;
$$;

-- 담당자 선택용 활성 직원 목록 (id, 이름)
create or replace function public.active_user_names() returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name from public.profiles p
  where p.is_active and public.is_active_user() order by p.name;
$$;

-- 해당 담당자·연월의 월차보고가 제출 이후 상태인가 (수정 잠금 + 공유 범위 기준)
create or replace function public.month_submitted(p_uid uuid, p_year integer, p_month integer) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.monthly_reports r
                 where r.user_id = p_uid and r.year = p_year and r.month = p_month
                   and r.status in ('submitted','reviewed','finalized'));
$$;

create or replace function public.report_shared(p_report uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.monthly_reports r
                 where r.id = p_report and r.status in ('submitted','reviewed','finalized'));
$$;

create or replace function public.report_readable(p_report uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_user() and exists (
    select 1 from public.monthly_reports r
    where r.id = p_report and (r.user_id = (select auth.uid()) or public.is_admin()));
$$;

-- 작성자 본인 + 작성중/반려 상태일 때만 내용 수정 가능
create or replace function public.report_editable(p_report uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_user() and exists (
    select 1 from public.monthly_reports r
    where r.id = p_report and r.user_id = (select auth.uid()) and r.status in ('draft','rejected'));
$$;

-- 로그인 화면(비로그인)에 보여 줄 안내만 공개
create or replace function public.login_notice() returns table (lab_name text, admin_contact text)
language sql stable security definer set search_path = '' as $$
  select coalesce((select value from public.app_settings where key = 'lab_name'), ''),
         coalesce((select value from public.app_settings where key = 'admin_contact'), '');
$$;

-- 내부용: 알림 생성
create or replace function public.notify(p_user uuid, p_type text, p_title text, p_body text, p_link text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, title, body, link)
  values (p_user, p_type, p_title, coalesce(p_body, ''), coalesce(p_link, ''));
$$;

create or replace function public.notify_admins(p_type text, p_title text, p_body text, p_link text, p_except uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, title, body, link)
  select p.id, p_type, p_title, coalesce(p_body, ''), coalesce(p_link, '')
  from public.profiles p
  where p.role = 'admin' and p.is_active and (p_except is null or p.id <> p_except);
$$;

-- ---------------------------------------------------------------------
-- 7. 트리거: 갱신 시각/버전, 직접 변경 금지 항목
--    current_user 가 authenticated/anon 이면 "사용자 직접 요청"이다.
--    (SECURITY DEFINER 함수 안에서는 함수 소유자로 실행되므로 통과)
-- ---------------------------------------------------------------------
create or replace function public.tg_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;

create or replace function public.tg_touch_simple() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.tg_profiles_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated','anon') then
    if new.id <> old.id then
      raise exception '계정 식별자는 변경할 수 없습니다.' using errcode = 'MR403';
    end if;
    if (new.role <> old.role or new.is_active <> old.is_active or lower(new.email) <> lower(old.email)) then
      if not public.is_admin() then
        raise exception '역할·활성 상태·이메일은 관리자만 변경할 수 있습니다.' using errcode = 'MR403';
      end if;
      if old.id = (select auth.uid()) and (new.role <> old.role or new.is_active <> old.is_active) then
        raise exception '본인의 역할과 활성 상태는 변경할 수 없습니다.' using errcode = 'MR400';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

create or replace function public.tg_products_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.revision <> '' then
      insert into public.product_revisions (product_id, revision, prev_revision, changed_by)
      values (new.id, new.revision, null, (select auth.uid()));
    end if;
  elsif new.revision is distinct from old.revision then
    insert into public.product_revisions (product_id, revision, prev_revision, changed_by)
    values (new.id, new.revision, old.revision, (select auth.uid()));
  end if;
  return null;
end $$;
create trigger products_touch before update on public.products
  for each row execute function public.tg_touch();
create trigger products_revision after insert or update on public.products
  for each row execute function public.tg_products_revision();

create trigger work_categories_touch before update on public.work_categories
  for each row execute function public.tg_touch_simple();
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.tg_touch_simple();

create or replace function public.tg_monthly_reports_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated','anon') then
      new.status := 'draft';
      new.reject_reason := null; new.submitted_at := null; new.reviewed_at := null;
      new.finalized_at := null; new.rejected_at := null; new.version := 1;
    end if;
    return new;
  end if;
  if current_user in ('authenticated','anon') then
    if new.status is distinct from old.status then
      raise exception '보고서 상태는 직접 변경할 수 없습니다.' using errcode = 'MR403';
    end if;
    if new.user_id <> old.user_id or new.year <> old.year or new.month <> old.month then
      raise exception '보고서의 작성자와 보고 연월은 변경할 수 없습니다.' using errcode = 'MR403';
    end if;
    new.reject_reason := old.reject_reason; new.submitted_at := old.submitted_at;
    new.reviewed_at := old.reviewed_at; new.finalized_at := old.finalized_at;
    new.rejected_at := old.rejected_at;
  end if;
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;
create trigger monthly_reports_guard before insert or update on public.monthly_reports
  for each row execute function public.tg_monthly_reports_guard();

create trigger report_items_touch before update on public.report_items
  for each row execute function public.tg_touch();
create trigger dev_projects_touch before update on public.dev_projects
  for each row execute function public.tg_touch();

create or replace function public.tg_dev_project_monthly() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'done' then new.progress := 100; end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.version := old.version + 1;
  end if;
  return new;
end $$;
create trigger dev_project_monthly_guard before insert or update on public.dev_project_monthly
  for each row execute function public.tg_dev_project_monthly();

create or replace function public.tg_dev_works_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- 보고 월의 상태가 완료면 진행률은 100%
  if new.status = 'done' then new.progress := 100; end if;
  if tg_op = 'UPDATE' then
    if current_user in ('authenticated','anon') then
      if new.year <> old.year or new.month <> old.month then
        raise exception '기록의 보고 연월은 변경할 수 없습니다.' using errcode = 'MR403';
      end if;
      if new.carried_from_id is distinct from old.carried_from_id then
        raise exception '이월 연결 정보는 변경할 수 없습니다.' using errcode = 'MR403';
      end if;
    end if;
    new.updated_at := now();
    new.version := old.version + 1;
  end if;
  if current_user in ('authenticated','anon') then
    new.updated_by := (select auth.uid());
  end if;
  return new;
end $$;
create trigger dev_works_guard before insert or update on public.dev_works
  for each row execute function public.tg_dev_works_guard();

create or replace function public.tg_transfers_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if current_user in ('authenticated','anon') and (new.year <> old.year or new.month <> old.month) then
      raise exception '기록의 보고 연월은 변경할 수 없습니다.' using errcode = 'MR403';
    end if;
    new.updated_at := now();
    new.version := old.version + 1;
  end if;
  if current_user in ('authenticated','anon') then
    new.updated_by := (select auth.uid());
  end if;
  return new;
end $$;
create trigger transfers_guard before insert or update on public.transfers
  for each row execute function public.tg_transfers_guard();

create or replace function public.tg_sales_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    -- 가져오기 추적 정보와 원본 금액은 수정으로 바뀌지 않는다.
    new.import_key := old.import_key; new.import_id := old.import_id;
    new.source_file := old.source_file; new.source_sheet := old.source_sheet; new.source_row := old.source_row;
    new.orig_supply_amount := old.orig_supply_amount; new.orig_vat_amount := old.orig_vat_amount;
    new.orig_total_amount := old.orig_total_amount;
    new.is_edited := true;
    new.updated_at := now();
    new.version := old.version + 1;
  end if;
  return new;
end $$;
create trigger sales_guard before update on public.sales
  for each row execute function public.tg_sales_guard();

-- ---------------------------------------------------------------------
-- 8. 업무 함수 (상태 전이·이월·관리자 월별 상태 수정)
--    오류 코드: MR400 잘못된 요청 / MR403 권한 없음 / MR404 없음 / MR409 충돌
-- ---------------------------------------------------------------------
create or replace function public.report_transition(p_report uuid, p_action text, p_reason text default null)
returns public.monthly_reports
language plpgsql security definer set search_path = '' as $$
declare
  r       public.monthly_reports;
  v_uid   uuid := (select auth.uid());
  v_admin boolean := public.is_admin();
  v_new   text;
  v_name  text;
  v_label text;
  v_link  text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null or not public.is_active_user() then
    raise exception '권한이 없습니다.' using errcode = 'MR403';
  end if;
  select * into r from public.monthly_reports where id = p_report for update;
  if not found or (r.user_id <> v_uid and not v_admin) then
    raise exception '보고서를 찾을 수 없습니다.' using errcode = 'MR404';
  end if;

  if p_action = 'submit' then
    if r.user_id <> v_uid then raise exception '작성자만 제출할 수 있습니다.' using errcode = 'MR403'; end if;
    if r.status not in ('draft','rejected') then
      raise exception '작성중 또는 반려 상태에서만 제출할 수 있습니다.' using errcode = 'MR409';
    end if;
    v_new := 'submitted';
  elsif p_action = 'cancel' then
    if r.user_id <> v_uid then raise exception '작성자만 제출을 취소할 수 있습니다.' using errcode = 'MR403'; end if;
    if r.status <> 'submitted' then
      raise exception '관리자 검토 전(제출완료 상태)에만 제출을 취소할 수 있습니다.' using errcode = 'MR409';
    end if;
    v_new := 'draft';
  elsif p_action = 'review' then
    if not v_admin then raise exception '관리자만 확인 처리할 수 있습니다.' using errcode = 'MR403'; end if;
    if r.status <> 'submitted' then
      raise exception '제출완료 상태의 보고서만 확인 처리할 수 있습니다.' using errcode = 'MR409';
    end if;
    v_new := 'reviewed';
  elsif p_action = 'finalize' then
    if not v_admin then raise exception '관리자만 최종확정할 수 있습니다.' using errcode = 'MR403'; end if;
    if r.status <> 'reviewed' then
      raise exception '관리자 확인 상태의 보고서만 최종확정할 수 있습니다.' using errcode = 'MR409';
    end if;
    v_new := 'finalized';
  elsif p_action = 'reject' then
    if not v_admin then raise exception '관리자만 반려할 수 있습니다.' using errcode = 'MR403'; end if;
    if r.status not in ('submitted','reviewed','finalized') then
      raise exception '제출 이후 상태의 보고서만 반려할 수 있습니다.' using errcode = 'MR409';
    end if;
    if v_reason is null then
      raise exception '반려 사유를 입력해 주세요.' using errcode = 'MR400';
    end if;
    v_new := 'rejected';
  else
    raise exception '알 수 없는 요청입니다.' using errcode = 'MR400';
  end if;

  insert into public.report_status_history (report_id, from_status, to_status, actor_id, reason)
  values (r.id, r.status, v_new, v_uid, case when p_action = 'reject' then v_reason end);

  update public.monthly_reports set
    status = v_new,
    submitted_at = case when v_new = 'submitted' then now() when v_new = 'draft' then null else submitted_at end,
    reviewed_at  = case when v_new = 'reviewed' then now() when v_new in ('draft','submitted','rejected') then null else reviewed_at end,
    finalized_at = case when v_new = 'finalized' then now() when v_new in ('draft','submitted','rejected') then null else finalized_at end,
    rejected_at  = case when v_new = 'rejected' then now() else rejected_at end,
    reject_reason = case when v_new = 'rejected' then v_reason when v_new = 'submitted' then null else reject_reason end
  where id = r.id
  returning * into r;

  select name into v_name from public.profiles where id = r.user_id;
  v_label := r.year || '년 ' || r.month || '월 월차보고';
  v_link := '/reports/' || r.id;
  if p_action = 'submit' then
    perform public.notify_admins('report_submitted', v_name || '님이 ' || v_label || '를 제출했습니다.', '', v_link, v_uid);
  elsif p_action = 'cancel' then
    perform public.notify_admins('report_cancelled', v_name || '님이 ' || v_label || ' 제출을 취소했습니다.', '', v_link, v_uid);
  elsif r.user_id <> v_uid then
    perform public.notify(r.user_id,
      'report_' || v_new,
      v_label || case v_new when 'reviewed' then '를 관리자가 확인했습니다.'
                            when 'finalized' then '가 최종확정되었습니다.'
                            else '가 반려되었습니다.' end,
      coalesce(case when v_new = 'rejected' then '사유: ' || v_reason end, ''),
      v_link);
  end if;
  return r;
end $$;

-- 전월 업무 이월: 예정·진행중·보류만, 같은 업무는 한 번만.
create or replace function public.carry_over_dev_works(p_ids uuid[], p_year integer, p_month integer)
returns table (created integer, skipped integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean := public.is_admin();
  v_prev_year integer := case when p_month = 1 then p_year - 1 else p_year end;
  v_prev_month integer := case when p_month = 1 then 12 else p_month - 1 end;
  v_created integer := 0;
  v_total integer := 0;
  w public.dev_works;
  v_new uuid;
begin
  if v_uid is null or not public.is_active_user() then
    raise exception '권한이 없습니다.' using errcode = 'MR403';
  end if;
  if p_month not between 1 and 12 then
    raise exception '보고 월이 올바르지 않습니다.' using errcode = 'MR400';
  end if;
  for w in
    select * from public.dev_works d
    where d.id = any(p_ids) and d.year = v_prev_year and d.month = v_prev_month
      and d.status in ('planned','in_progress','on_hold')
      and (d.user_id = v_uid or v_admin)
    order by d.created_at
    for update
  loop
    v_total := v_total + 1;
    if not v_admin and public.month_submitted(w.user_id, p_year, p_month) then
      raise exception '제출된 월에는 업무를 이월할 수 없습니다.' using errcode = 'MR409';
    end if;
    v_new := null;
    insert into public.dev_works
      (user_id, year, month, product_id, revision, category_id, title, status, progress, carried_from_id, updated_by)
    values
      (w.user_id, p_year, p_month, w.product_id, w.revision, w.category_id, w.title, w.status, w.progress, w.id, v_uid)
    on conflict (carried_from_id) where carried_from_id is not null do nothing
    returning id into v_new;
    if v_new is not null then v_created := v_created + 1; end if;
  end loop;
  return query select v_created, coalesce(array_length(p_ids, 1), 0) - v_created;
end $$;

-- 관리자: 선택한 월 기록의 상태만 변경 (다른 월·담당자·상세 내용·이관일 보존)
create or replace function public.admin_set_month_status(p_kind text, p_id uuid, p_status text, p_version integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_version integer;
  v_year integer; v_month integer;
  v_product text;
begin
  if not public.is_admin() then
    raise exception '관리자만 변경할 수 있습니다.' using errcode = 'MR403';
  end if;
  if p_status not in ('planned','in_progress','done','on_hold','stopped') then
    raise exception '상태 값이 올바르지 않습니다.' using errcode = 'MR400';
  end if;
  if p_kind = 'dev' then
    update public.dev_works set status = p_status, updated_by = v_uid
    where id = p_id and version = p_version
    returning user_id, version, year, month into v_owner, v_version, v_year, v_month;
    if not found then
      if exists (select 1 from public.dev_works where id = p_id) then
        raise exception '다른 화면에서 먼저 수정되었습니다. 새로 고친 뒤 다시 시도해 주세요.' using errcode = 'MR409';
      end if;
      raise exception '기록을 찾을 수 없습니다.' using errcode = 'MR404';
    end if;
    select p.name || ' ' || p.model into v_product from public.products p
      join public.dev_works d on d.product_id = p.id where d.id = p_id;
  elsif p_kind = 'transfer' then
    update public.transfers set transfer_status = p_status, updated_by = v_uid
    where id = p_id and version = p_version
    returning user_id, version, year, month into v_owner, v_version, v_year, v_month;
    if not found then
      if exists (select 1 from public.transfers where id = p_id) then
        raise exception '다른 화면에서 먼저 수정되었습니다. 새로 고친 뒤 다시 시도해 주세요.' using errcode = 'MR409';
      end if;
      raise exception '기록을 찾을 수 없습니다.' using errcode = 'MR404';
    end if;
    select p.name || ' ' || p.model into v_product from public.products p
      join public.transfers t on t.product_id = p.id where t.id = p_id;
  else
    raise exception '알 수 없는 구분입니다.' using errcode = 'MR400';
  end if;
  if v_owner <> v_uid then
    perform public.notify(v_owner, 'month_status_changed',
      v_year || '년 ' || v_month || '월 ' || case p_kind when 'dev' then '개발현황' else '생산이관' end || ' 상태를 관리자가 변경했습니다.',
      btrim(coalesce(v_product, '')),
      case p_kind when 'dev' then '/dev-status' else '/transfers' end || '?year=' || v_year || '&month=' || v_month);
  end if;
  return v_version;
end $$;

-- ---------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.products              enable row level security;
alter table public.product_revisions     enable row level security;
alter table public.work_categories       enable row level security;
alter table public.app_settings          enable row level security;
alter table public.monthly_reports       enable row level security;
alter table public.report_items          enable row level security;
alter table public.dev_projects          enable row level security;
alter table public.dev_project_monthly   enable row level security;
alter table public.report_status_history enable row level security;
alter table public.report_attachments    enable row level security;
alter table public.dev_works             enable row level security;
alter table public.transfers             enable row level security;
alter table public.sales_imports         enable row level security;
alter table public.sales                 enable row level security;
alter table public.sales_closings        enable row level security;
alter table public.notifications         enable row level security;

-- profiles: 본인(활성) 또는 관리자
create policy profiles_select on public.profiles for select to authenticated
  using ((id = (select auth.uid()) and is_active) or public.is_admin());
create policy profiles_insert on public.profiles for insert to authenticated
  with check (public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using ((id = (select auth.uid()) and is_active) or public.is_admin())
  with check ((id = (select auth.uid()) and is_active) or public.is_admin());

-- 기준정보: 활성 사용자 조회, 관리자 변경 (삭제는 soft delete)
create policy products_select on public.products for select to authenticated using (public.is_active_user());
create policy products_insert on public.products for insert to authenticated with check (public.is_admin());
create policy products_update on public.products for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy product_revisions_select on public.product_revisions for select to authenticated
  using (public.is_active_user());

create policy work_categories_select on public.work_categories for select to authenticated using (public.is_active_user());
create policy work_categories_insert on public.work_categories for insert to authenticated with check (public.is_admin());
create policy work_categories_update on public.work_categories for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy work_categories_delete on public.work_categories for delete to authenticated using (public.is_admin());

create policy app_settings_select on public.app_settings for select to authenticated using (public.is_active_user());
create policy app_settings_insert on public.app_settings for insert to authenticated with check (public.is_admin());
create policy app_settings_update on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 월차보고: 본인 또는 관리자 조회. 내용 수정은 본인 + 작성중/반려.
create policy monthly_reports_select on public.monthly_reports for select to authenticated
  using (public.is_active_user() and (user_id = (select auth.uid()) or public.is_admin()));
create policy monthly_reports_insert on public.monthly_reports for insert to authenticated
  with check (public.is_active_user() and user_id = (select auth.uid()) and status = 'draft');
create policy monthly_reports_update on public.monthly_reports for update to authenticated
  using (public.is_active_user() and user_id = (select auth.uid()) and status in ('draft','rejected'))
  with check (public.is_active_user() and user_id = (select auth.uid()) and status in ('draft','rejected'));

-- 보고 항목: 본인/관리자 + (제출 이후의 도면·사양서는 제품 개발이력으로 공유)
create policy report_items_select on public.report_items for select to authenticated
  using (public.report_readable(report_id)
         or (public.is_active_user() and section in ('sm_drawing','spec')
             and product_id is not null and public.report_shared(report_id)));
create policy report_items_insert on public.report_items for insert to authenticated
  with check (public.report_editable(report_id));
create policy report_items_update on public.report_items for update to authenticated
  using (public.report_editable(report_id)) with check (public.report_editable(report_id));
create policy report_items_delete on public.report_items for delete to authenticated
  using (public.report_editable(report_id));

create policy dev_projects_select on public.dev_projects for select to authenticated
  using (public.is_active_user() and (user_id = (select auth.uid()) or public.is_admin()));
create policy dev_projects_insert on public.dev_projects for insert to authenticated
  with check (public.is_active_user() and user_id = (select auth.uid()));
create policy dev_projects_update on public.dev_projects for update to authenticated
  using (public.is_active_user() and user_id = (select auth.uid()))
  with check (public.is_active_user() and user_id = (select auth.uid()));
create policy dev_projects_delete on public.dev_projects for delete to authenticated
  using (public.is_active_user() and user_id = (select auth.uid())
         and not exists (select 1 from public.dev_project_monthly m
                         where m.project_id = dev_projects.id and not public.report_editable(m.report_id)));

create policy dev_project_monthly_select on public.dev_project_monthly for select to authenticated
  using (public.report_readable(report_id));
create policy dev_project_monthly_insert on public.dev_project_monthly for insert to authenticated
  with check (public.report_editable(report_id)
              and exists (select 1 from public.dev_projects p where p.id = project_id and p.user_id = (select auth.uid())));
create policy dev_project_monthly_update on public.dev_project_monthly for update to authenticated
  using (public.report_editable(report_id)) with check (public.report_editable(report_id));
create policy dev_project_monthly_delete on public.dev_project_monthly for delete to authenticated
  using (public.report_editable(report_id));

create policy report_status_history_select on public.report_status_history for select to authenticated
  using (public.report_readable(report_id));

create policy report_attachments_select on public.report_attachments for select to authenticated
  using (public.report_readable(report_id));
create policy report_attachments_insert on public.report_attachments for insert to authenticated
  with check (public.report_editable(report_id) and uploaded_by = (select auth.uid()));
create policy report_attachments_delete on public.report_attachments for delete to authenticated
  using (public.report_editable(report_id));

-- 개발현황: 본인 / 관리자 / 제출 이후 공유. 직원은 제출된 월을 수정할 수 없다.
create policy dev_works_select on public.dev_works for select to authenticated
  using (public.is_active_user() and (user_id = (select auth.uid()) or public.is_admin()
         or public.month_submitted(user_id, year, month)));
create policy dev_works_insert on public.dev_works for insert to authenticated
  with check (public.is_admin() or (public.is_active_user() and user_id = (select auth.uid())
              and not public.month_submitted(user_id, year, month)));
create policy dev_works_update on public.dev_works for update to authenticated
  using (public.is_admin() or (public.is_active_user() and user_id = (select auth.uid())
         and not public.month_submitted(user_id, year, month)))
  with check (public.is_admin() or (public.is_active_user() and user_id = (select auth.uid())
              and not public.month_submitted(user_id, year, month)));
create policy dev_works_delete on public.dev_works for delete to authenticated
  using (public.is_admin() or (public.is_active_user() and user_id = (select auth.uid())
         and not public.month_submitted(user_id, year, month)));

create policy transfers_select on public.transfers for select to authenticated
  using (public.is_active_user() and (user_id = (select auth.uid()) or public.is_admin()
         or public.month_submitted(user_id, year, month)));
create policy transfers_insert on public.transfers for insert to authenticated
  with check (public.is_admin() or (public.is_active_user() and user_id = (select auth.uid())
              and not public.month_submitted(user_id, year, month)));
create policy transfers_update on public.transfers for update to authenticated
  using (public.is_admin() or (public.is_active_user() and user_id = (select auth.uid())
         and not public.month_submitted(user_id, year, month)))
  with check (public.is_admin() or (public.is_active_user() and user_id = (select auth.uid())
              and not public.month_submitted(user_id, year, month)));
create policy transfers_delete on public.transfers for delete to authenticated
  using (public.is_admin() or (public.is_active_user() and user_id = (select auth.uid())
         and not public.month_submitted(user_id, year, month)));

-- 매출: 관리자 전용
create policy sales_imports_all on public.sales_imports for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy sales_all on public.sales for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy sales_closings_all on public.sales_closings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 알림: 본인 것만. 생성은 내부 함수로만.
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and public.is_active_user());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and public.is_active_user())
  with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()) and public.is_active_user());

-- ---------------------------------------------------------------------
-- 10. 권한 부여 (비로그인 anon 에는 로그인 안내 함수만)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select, insert, update on public.profiles, public.products, public.app_settings, public.monthly_reports to authenticated;
grant select on public.product_revisions, public.report_status_history to authenticated;
grant select, insert, update, delete on
  public.work_categories, public.report_items, public.dev_projects, public.dev_project_monthly,
  public.dev_works, public.transfers, public.sales_imports, public.sales, public.sales_closings to authenticated;
grant select, insert, delete on public.report_attachments to authenticated;
grant select, update, delete on public.notifications to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_active_user(), public.is_admin(), public.user_name(uuid), public.active_user_names(),
  public.month_submitted(uuid, integer, integer), public.report_shared(uuid),
  public.report_readable(uuid), public.report_editable(uuid),
  public.report_transition(uuid, text, text),
  public.carry_over_dev_works(uuid[], integer, integer),
  public.admin_set_month_status(text, uuid, text, integer)
to authenticated;
grant execute on function public.login_notice() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 11. 기본 데이터 (운영 공통. 검증용 가상 데이터는 dev/seed-demo.mjs 로 분리)
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('lab_name', '연구소'),
  ('admin_contact', '비밀번호를 잊으셨다면 연구소 관리자에게 재설정을 요청해 주세요.'),
  ('attachment_max_mb', '30')
on conflict (key) do nothing;

insert into public.work_categories (name, sort_order) values
  ('신규개발', 10), ('개선/변경', 20), ('시험/검증', 30), ('양산지원', 40), ('교육', 50), ('기타', 90)
on conflict do nothing;
