alter table public.admin_communication_threads
  add column if not exists nex_mode text not null default 'automatic',
  add column if not exists nex_resume_after_minutes integer not null default 120,
  add column if not exists nex_paused_until timestamptz,
  add column if not exists last_manual_reply_at timestamptz,
  add column if not exists nex_last_reply_at timestamptz,
  add column if not exists nex_pending_inbound_message_id uuid references public.admin_communication_messages(id) on delete set null,
  add column if not exists nex_pending_claimed_at timestamptz,
  add column if not exists nex_last_replied_to_message_id uuid references public.admin_communication_messages(id) on delete set null;

alter table public.admin_communication_threads
  drop constraint if exists admin_communication_threads_nex_mode_check,
  add constraint admin_communication_threads_nex_mode_check
    check (nex_mode in ('automatic', 'never')),
  drop constraint if exists admin_communication_threads_nex_resume_check,
  add constraint admin_communication_threads_nex_resume_check
    check (nex_resume_after_minutes between 5 and 10080);

create index if not exists admin_communication_threads_nex_pending_idx
  on public.admin_communication_threads (nex_pending_claimed_at)
  where nex_pending_inbound_message_id is not null;

create or replace function public.claim_admin_communication_nex_reply(
  p_thread_id uuid,
  p_message_id uuid,
  p_claimed_at timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_thread public.admin_communication_threads%rowtype;
begin
  update public.admin_communication_threads as thread
  set nex_pending_inbound_message_id = p_message_id,
      nex_pending_claimed_at = p_claimed_at,
      updated_at = p_claimed_at
  where thread.id = p_thread_id
    and thread.nex_mode = 'automatic'
    and (thread.nex_paused_until is null or thread.nex_paused_until <= p_claimed_at)
    and thread.nex_last_replied_to_message_id is distinct from p_message_id
    and (
      thread.nex_pending_inbound_message_id is null
      or thread.nex_pending_claimed_at < p_claimed_at - interval '2 minutes'
    )
    and exists (
      select 1
      from public.admin_communication_messages as message
      where message.id = p_message_id
        and message.thread_id = thread.id
        and message.direction = 'inbound'
        and message.id = (
          select latest.id
          from public.admin_communication_messages as latest
          where latest.thread_id = thread.id
          order by latest.message_at desc, latest.created_at desc, latest.id desc
          limit 1
        )
    )
  returning thread.* into v_thread;

  if v_thread.id is null then
    return jsonb_build_object('should_reply', false);
  end if;
  return jsonb_build_object(
    'should_reply', true,
    'thread_id', v_thread.id,
    'phone_e164', v_thread.phone_e164,
    'resume_after_minutes', v_thread.nex_resume_after_minutes
  );
end;
$$;

revoke execute on function public.claim_admin_communication_nex_reply(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_admin_communication_nex_reply(uuid, uuid, timestamptz)
  to service_role;
