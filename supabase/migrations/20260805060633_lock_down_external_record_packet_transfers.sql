create policy "record_packet_transfer_requests_edge_function_only"
on public.record_packet_transfer_requests
for all
to anon, authenticated
using (false)
with check (false);
;
