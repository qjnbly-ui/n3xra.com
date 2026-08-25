begin;

do $$
declare
  v_thread_id uuid;
  v_first_message_id uuid;
  v_second_message_id uuid;
  v_result jsonb;
begin
  insert into public.admin_communication_threads (phone_e164)
  values ('+15415550199')
  returning id into v_thread_id;

  insert into public.admin_communication_messages (
    thread_id, twilio_message_sid, direction, body, message_status,
    from_e164, to_e164, message_at
  ) values (
    v_thread_id, 'SM-NEX-CLAIM-1', 'inbound', 'Can Nex help?', 'received',
    '+15415550199', '+15416526840', now()
  ) returning id into v_first_message_id;

  select public.claim_admin_communication_nex_reply(v_thread_id, v_first_message_id, now())
  into v_result;
  if not coalesce((v_result ->> 'should_reply')::boolean, false) then
    raise exception 'Nex did not claim an eligible incoming message';
  end if;

  select public.claim_admin_communication_nex_reply(v_thread_id, v_first_message_id, now())
  into v_result;
  if coalesce((v_result ->> 'should_reply')::boolean, false) then
    raise exception 'Nex claimed the same incoming message twice';
  end if;

  update public.admin_communication_threads
  set nex_mode = 'never',
      nex_pending_inbound_message_id = null,
      nex_pending_claimed_at = null
  where id = v_thread_id;

  insert into public.admin_communication_messages (
    thread_id, twilio_message_sid, direction, body, message_status,
    from_e164, to_e164, message_at
  ) values (
    v_thread_id, 'SM-NEX-CLAIM-2', 'inbound', 'Are you there?', 'received',
    '+15415550199', '+15416526840', now() + interval '1 second'
  ) returning id into v_second_message_id;

  select public.claim_admin_communication_nex_reply(v_thread_id, v_second_message_id, now())
  into v_result;
  if coalesce((v_result ->> 'should_reply')::boolean, false) then
    raise exception 'Nex entered a conversation marked never';
  end if;

  update public.admin_communication_threads
  set nex_mode = 'automatic',
      nex_paused_until = now() + interval '2 hours'
  where id = v_thread_id;

  select public.claim_admin_communication_nex_reply(v_thread_id, v_second_message_id, now())
  into v_result;
  if coalesce((v_result ->> 'should_reply')::boolean, false) then
    raise exception 'Nex entered during the manual inactivity window';
  end if;
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.claim_admin_communication_nex_reply(uuid,uuid,timestamptz)', 'execute') then
    raise exception 'anon can execute the private Nex claim function';
  end if;
  if not has_function_privilege('service_role', 'public.claim_admin_communication_nex_reply(uuid,uuid,timestamptz)', 'execute') then
    raise exception 'service_role cannot execute the Nex claim function';
  end if;
end;
$$;

rollback;
