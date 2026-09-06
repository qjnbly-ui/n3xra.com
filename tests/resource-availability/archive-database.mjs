// Run against a disposable in-memory PostgreSQL runtime, never production.
// RA_PGLITE_PATH may point to a temporary pinned @electric-sql/pglite installation.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.RA_PGLITE_PATH?pathToFileURL(process.env.RA_PGLITE_PATH).href:'@electric-sql/pglite');
const db=new PGlite();
const org='f30f90e6-c13b-4142-a258-9e93d2ba5f12';
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
await db.exec(`create role anon;create role authenticated;create role service_role;
create schema auth;create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
create table public.organizations(id uuid primary key,name text,owner_user_id uuid,account_status text);
create table public.organization_memberships(organization_id uuid,user_id uuid,role text);
create function public.is_platform_admin() returns boolean language sql stable as $$select auth.uid()='${uid(9)}'::uuid$$;
create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
grant select on public.organizations,public.organization_memberships to authenticated;
insert into auth.users values ${[1,2,3,4,5,9].map(n=>`('${uid(n)}','person${n}@example.com')`).join(',')};
insert into public.organizations values('${org}','Klamath County Fire Defense Board','${uid(1)}','active');
insert into public.organization_memberships values('${org}','${uid(2)}','editor'),('${org}','${uid(3)}','viewer'),('${org}','${uid(5)}','editor');`);
await db.exec(await readFile(new URL('../../supabase/migrations/20260905215808_organization_private_products.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/20260906005357_resource_availability.sql',import.meta.url),'utf8'));

await db.exec(await readFile(new URL('../../supabase/migrations/20260906005411_resource_availability_shared_settings.sql',import.meta.url),'utf8'));

await db.exec(await readFile(new URL('../../supabase/migrations/20260906011820_resource_availability_archive.sql',import.meta.url),'utf8'));
const w=(await db.query('select id from public.ra_workspaces')).rows[0].id;
await db.query("update public.organization_private_products set status='active' where id=$1",[w]);
const b=(await db.query("insert into public.ra_archive_batches(workspace_id,source_sheet,file_sha256,expected_rows) values($1,'sheet',repeat('a',64),1) returning id",[w])).rows[0].id;
await db.query("insert into public.ra_archived_reports(workspace_id,batch_id,source_sheet,source_row,record_hash,source_created_at,raw) values($1,$2,'sheet',1,repeat('b',64),'2023-01-01','{\"Notes\":\"Original\"}')",[w,b]);
const as=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);await db.exec(`set role ${n?'authenticated':'anon'}`);};
await as(3);assert.equal((await db.query('select * from public.ra_archived_reports')).rows.length,0);
await db.exec('reset role');await db.query('update public.ra_archive_batches set verified=true where id=$1',[b]);
for(const n of [1,2,3,9]){await as(n);assert.equal((await db.query('select * from public.ra_archived_reports')).rows.length,1);await assert.rejects(()=>db.query("update public.ra_archived_reports set raw='{}'"),/permission denied/);}
await as(4);assert.equal((await db.query('select * from public.ra_archived_reports')).rows.length,0);assert.equal((await db.query('select * from public.ra_archive_batches')).rows.length,0);
await as(null);await assert.rejects(()=>db.query('select * from public.ra_archived_reports'),/permission denied/);
await db.exec('reset role');await db.query("update public.organization_private_products set status='paused' where id=$1",[w]);await as(3);assert.equal((await db.query('select * from public.ra_archived_reports')).rows.length,0);
console.log('Archive visibility, verification gate, immutable rows, member/admin access, outsider and anonymous isolation passed.');await db.close();
