create index loan_invitations_invited_by_idx on public.loan_invitations(invited_by);
create index loan_invitations_accepted_by_idx on public.loan_invitations(accepted_by) where accepted_by is not null;
create index loan_members_invited_by_idx on public.loan_members(invited_by);
