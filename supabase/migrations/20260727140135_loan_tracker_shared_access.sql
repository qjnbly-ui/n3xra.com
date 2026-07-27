create table public.loan_invitations (
  id uuid primary key default gen_random_uuid(),
  loan_account_id uuid not null references public.loan_accounts(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  invited_email text not null check (invited_email = lower(btrim(invited_email))),
  invited_name text,
  token_hash text not null unique check (length(token_hash) = 64),
  permissions jsonb not null default '{}'::jsonb check (
    jsonb_typeof(permissions) = 'object'
    and permissions - array['view_payments', 'use_calculator', 'export_data', 'manage_payments', 'reveal_loan_number'] = '{}'::jsonb
    and (not (permissions ? 'view_payments') or jsonb_typeof(permissions -> 'view_payments') = 'boolean')
    and (not (permissions ? 'use_calculator') or jsonb_typeof(permissions -> 'use_calculator') = 'boolean')
    and (not (permissions ? 'export_data') or jsonb_typeof(permissions -> 'export_data') = 'boolean')
    and (not (permissions ? 'manage_payments') or jsonb_typeof(permissions -> 'manage_payments') = 'boolean')
    and (not (permissions ? 'reveal_loan_number') or jsonb_typeof(permissions -> 'reveal_loan_number') = 'boolean')
  ),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '30 days'),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.loan_accounts
add column if not exists loan_number_last_four text
generated always as (right(loan_number, 4)) stored;

create table public.loan_members (
  id uuid primary key default gen_random_uuid(),
  loan_account_id uuid not null references public.loan_accounts(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  invited_email text not null,
  display_name text,
  permissions jsonb not null default '{}'::jsonb check (
    jsonb_typeof(permissions) = 'object'
    and permissions - array['view_payments', 'use_calculator', 'export_data', 'manage_payments', 'reveal_loan_number'] = '{}'::jsonb
    and (not (permissions ? 'view_payments') or jsonb_typeof(permissions -> 'view_payments') = 'boolean')
    and (not (permissions ? 'use_calculator') or jsonb_typeof(permissions -> 'use_calculator') = 'boolean')
    and (not (permissions ? 'export_data') or jsonb_typeof(permissions -> 'export_data') = 'boolean')
    and (not (permissions ? 'manage_payments') or jsonb_typeof(permissions -> 'manage_payments') = 'boolean')
    and (not (permissions ? 'reveal_loan_number') or jsonb_typeof(permissions -> 'reveal_loan_number') = 'boolean')
  ),
  status text not null default 'active' check (status in ('active', 'revoked')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (loan_account_id, user_id)
);

create unique index loan_invitations_one_pending_email
on public.loan_invitations (loan_account_id, lower(invited_email))
where status = 'pending';

create index loan_invitations_owner_idx on public.loan_invitations(owner_user_id, created_at desc);
create index loan_members_user_idx on public.loan_members(user_id, status);
create index loan_members_owner_idx on public.loan_members(owner_user_id, status);

create or replace function private.protect_loan_access_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'loan_invitations' and (
    new.loan_account_id is distinct from old.loan_account_id
    or new.owner_user_id is distinct from old.owner_user_id
    or new.invited_email is distinct from old.invited_email
    or new.token_hash is distinct from old.token_hash
    or new.invited_by is distinct from old.invited_by
  ) then
    raise exception 'Invitation identity fields cannot be changed.';
  end if;

  if tg_table_name = 'loan_members' and (
    new.loan_account_id is distinct from old.loan_account_id
    or new.owner_user_id is distinct from old.owner_user_id
    or new.user_id is distinct from old.user_id
    or new.invited_email is distinct from old.invited_email
    or new.invited_by is distinct from old.invited_by
  ) then
    raise exception 'Member identity fields cannot be changed.';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_loan_access_identity() from public, anon, authenticated;

create trigger loan_invitations_protect_identity before update on public.loan_invitations
for each row execute function private.protect_loan_access_identity();

create trigger loan_members_protect_identity before update on public.loan_members
for each row execute function private.protect_loan_access_identity();

drop trigger if exists loan_invitations_set_updated_at on public.loan_invitations;
create trigger loan_invitations_set_updated_at before update on public.loan_invitations
for each row execute function public.set_updated_at();

drop trigger if exists loan_members_set_updated_at on public.loan_members;
create trigger loan_members_set_updated_at before update on public.loan_members
for each row execute function public.set_updated_at();

alter table public.loan_invitations enable row level security;
alter table public.loan_members enable row level security;

revoke all on public.loan_invitations from anon, authenticated;
revoke all on public.loan_members from anon, authenticated;
grant select, insert, update on public.loan_invitations to authenticated;
grant select, update on public.loan_members to authenticated;

create policy "loan_invitations_owner_or_admin_select"
on public.loan_invitations for select to authenticated
using (owner_user_id = (select auth.uid()) or (select public.is_platform_admin()));

create policy "loan_invitations_owner_or_admin_insert"
on public.loan_invitations for insert to authenticated
with check (
  invited_by = (select auth.uid())
  and (
    (
      owner_user_id = (select auth.uid())
      and exists (
        select 1 from public.loan_accounts
        where loan_accounts.id = loan_invitations.loan_account_id
          and loan_accounts.user_id = (select auth.uid())
      )
    )
    or (select public.is_platform_admin())
  )
);

create policy "loan_invitations_owner_or_admin_update"
on public.loan_invitations for update to authenticated
using (owner_user_id = (select auth.uid()) or (select public.is_platform_admin()))
with check (owner_user_id = (select auth.uid()) or (select public.is_platform_admin()));

create policy "loan_members_self_owner_or_admin_select"
on public.loan_members for select to authenticated
using (
  user_id = (select auth.uid())
  or owner_user_id = (select auth.uid())
  or (select public.is_platform_admin())
);

create policy "loan_members_owner_or_admin_update"
on public.loan_members for update to authenticated
using (owner_user_id = (select auth.uid()) or (select public.is_platform_admin()))
with check (owner_user_id = (select auth.uid()) or (select public.is_platform_admin()));

drop policy if exists "loan_accounts_owner_or_admin_select" on public.loan_accounts;
create policy "loan_accounts_owner_admin_or_member_select"
on public.loan_accounts for select to authenticated
using (
  (select auth.uid()) = user_id
  or (select public.is_platform_admin())
  or exists (
    select 1
    from public.loan_members
    where loan_members.loan_account_id = loan_accounts.id
      and loan_members.user_id = (select auth.uid())
      and loan_members.status = 'active'
  )
);

drop policy if exists "loan_payments_owner_or_admin_select" on public.loan_payments;
create policy "loan_payments_authorized_select"
on public.loan_payments for select to authenticated
using (
  (select public.is_platform_admin())
  or exists (
    select 1 from public.loan_accounts
    where loan_accounts.id = loan_payments.loan_account_id
      and loan_accounts.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.loan_members
    where loan_members.loan_account_id = loan_payments.loan_account_id
      and loan_members.user_id = (select auth.uid())
      and loan_members.status = 'active'
      and coalesce((loan_members.permissions ->> 'view_payments')::boolean, false)
  )
);

drop policy if exists "loan_payments_owner_or_admin_insert" on public.loan_payments;
create policy "loan_payments_authorized_insert"
on public.loan_payments for insert to authenticated
with check (
  (select public.is_platform_admin())
  or exists (
    select 1 from public.loan_accounts
    where loan_accounts.id = loan_payments.loan_account_id
      and loan_accounts.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.loan_members
    where loan_members.loan_account_id = loan_payments.loan_account_id
      and loan_members.user_id = (select auth.uid())
      and loan_members.status = 'active'
      and coalesce((loan_members.permissions ->> 'manage_payments')::boolean, false)
  )
);

drop policy if exists "loan_payments_owner_or_admin_update" on public.loan_payments;
create policy "loan_payments_authorized_update"
on public.loan_payments for update to authenticated
using (
  (select public.is_platform_admin())
  or exists (
    select 1 from public.loan_accounts
    where loan_accounts.id = loan_payments.loan_account_id
      and loan_accounts.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.loan_members
    where loan_members.loan_account_id = loan_payments.loan_account_id
      and loan_members.user_id = (select auth.uid())
      and loan_members.status = 'active'
      and coalesce((loan_members.permissions ->> 'manage_payments')::boolean, false)
  )
)
with check (
  (select public.is_platform_admin())
  or exists (
    select 1 from public.loan_accounts
    where loan_accounts.id = loan_payments.loan_account_id
      and loan_accounts.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.loan_members
    where loan_members.loan_account_id = loan_payments.loan_account_id
      and loan_members.user_id = (select auth.uid())
      and loan_members.status = 'active'
      and coalesce((loan_members.permissions ->> 'manage_payments')::boolean, false)
  )
);

create or replace function public.accept_loan_invitation(input_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  invitation public.loan_invitations%rowtype;
begin
  if current_user_id is null then
    raise exception 'Sign in before accepting this invitation.';
  end if;

  select lower(email)
  into current_email
  from auth.users
  where id = current_user_id
    and email_confirmed_at is not null;

  if current_email is null then
    raise exception 'A confirmed email address is required.';
  end if;

  select *
  into invitation
  from public.loan_invitations
  where token_hash = encode(extensions.digest(input_token, 'sha256'), 'hex')
  for update;

  if invitation.id is null
    or invitation.status <> 'pending'
    or invitation.expires_at <= now()
    or invitation.invited_email <> current_email then
    raise exception 'This invitation is invalid, expired, or belongs to another email address.';
  end if;

  insert into public.loan_members (
    loan_account_id,
    owner_user_id,
    user_id,
    invited_email,
    display_name,
    permissions,
    status,
    invited_by
  ) values (
    invitation.loan_account_id,
    invitation.owner_user_id,
    current_user_id,
    invitation.invited_email,
    invitation.invited_name,
    invitation.permissions,
    'active',
    invitation.invited_by
  )
  on conflict (loan_account_id, user_id) do update
  set invited_email = excluded.invited_email,
      display_name = excluded.display_name,
      permissions = excluded.permissions,
      status = 'active',
      invited_by = excluded.invited_by,
      updated_at = now();

  update public.loan_invitations
  set status = 'accepted',
      accepted_by = current_user_id,
      accepted_at = now()
  where id = invitation.id;

  return invitation.loan_account_id;
end;
$$;

revoke all on function public.accept_loan_invitation(text) from public, anon;
grant execute on function public.accept_loan_invitation(text) to authenticated;

create or replace function public.reveal_loan_number(input_loan_account_id uuid)
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  result text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select loan_number
  into result
  from public.loan_accounts
  where id = input_loan_account_id
    and (
      user_id = auth.uid()
      or public.is_platform_admin()
      or exists (
        select 1
        from public.loan_members
        where loan_members.loan_account_id = input_loan_account_id
          and loan_members.user_id = auth.uid()
          and loan_members.status = 'active'
          and coalesce((loan_members.permissions ->> 'reveal_loan_number')::boolean, false)
      )
    );

  if result is null then
    raise exception 'You do not have permission to reveal this loan number.';
  end if;

  return result;
end;
$$;

revoke all on function public.reveal_loan_number(uuid) from public, anon;
grant execute on function public.reveal_loan_number(uuid) to authenticated;

-- The full loan number is never returned by normal table reads. Authorized users
-- retrieve it through the checked function above.
revoke select on public.loan_accounts from authenticated;
grant select (
  id,
  user_id,
  name,
  borrower_name,
  payment_recipient_name,
  lender_name,
  loan_number_last_four,
  original_balance,
  amount_financed,
  current_official_balance,
  official_balance_date,
  annual_interest_rate,
  required_monthly_payment,
  planned_monthly_payment,
  private_payment_day,
  lender_due_day,
  first_payment_date,
  calculation_start_date,
  status,
  notes,
  created_at,
  updated_at
) on public.loan_accounts to authenticated;
