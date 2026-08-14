drop trigger if exists loan_invitations_protect_identity on public.loan_invitations;
drop trigger if exists loan_members_protect_identity on public.loan_members;
drop function if exists private.protect_loan_access_identity();

create function private.protect_loan_invitation_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.loan_account_id is distinct from old.loan_account_id
    or new.owner_user_id is distinct from old.owner_user_id
    or new.invited_email is distinct from old.invited_email
    or new.token_hash is distinct from old.token_hash
    or new.invited_by is distinct from old.invited_by then
    raise exception 'Invitation identity fields cannot be changed.';
  end if;
  return new;
end;
$$;

create function private.protect_loan_member_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.loan_account_id is distinct from old.loan_account_id
    or new.owner_user_id is distinct from old.owner_user_id
    or new.user_id is distinct from old.user_id
    or new.invited_email is distinct from old.invited_email
    or new.invited_by is distinct from old.invited_by then
    raise exception 'Member identity fields cannot be changed.';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_loan_invitation_identity() from public, anon, authenticated;
revoke all on function private.protect_loan_member_identity() from public, anon, authenticated;

create trigger loan_invitations_protect_identity before update on public.loan_invitations
for each row execute function private.protect_loan_invitation_identity();

create trigger loan_members_protect_identity before update on public.loan_members
for each row execute function private.protect_loan_member_identity();
