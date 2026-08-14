revoke execute on function public.redeem_invite_code(text) from public;
revoke execute on function public.redeem_invite_code(text) from anon;
grant execute on function public.redeem_invite_code(text) to authenticated;;
