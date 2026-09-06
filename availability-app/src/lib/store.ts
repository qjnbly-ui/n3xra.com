import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isBrandedPortalHostname, resolvePortalTenant, portalLoginUrl } from '../../../src/client-portal/tenant-context';
import { type Snapshot } from './model';

export type ArchiveFilters={year:string;agency:string;from:string;to:string;page:number};
export type ArchivePage={total:number;rows:{id:string;source_created_at:string|null;agency_name:string|null;submitted_by:string|null;raw:Record<string,unknown>}[];batches:{metadata:{years?:string[];agencies?:string[];comments?:{text:string;author:string;date:string}[]}}[]};
export interface Store { load(): Promise<Snapshot>; archive(filters:ArchiveFilters):Promise<ArchivePage>; command(action: string, args: Record<string,unknown>): Promise<unknown>; onSignedOut?:(callback:()=>void)=>()=>void }
export { portalLoginUrl };
export async function connect(): Promise<Store> {
  const config=(window as Window & { RECORDS_APP_CONFIG?: { supabaseUrl:string;supabaseAnonKey:string } }).RECORDS_APP_CONFIG;
  if(!config) throw new Error('The application connection is not configured.');
  const db=createClient(config.supabaseUrl,config.supabaseAnonKey);
  const {data,error}=await db.auth.getUser();
  if(error || !data.user) throw new Error('Sign in to open your organization’s Resource Availability app.');
  const params=new URLSearchParams(location.search);
  let org=params.get('organization');
  if(isBrandedPortalHostname()) {
    const tenant=await resolvePortalTenant({rpc:async(name,args)=>{const r=await db.rpc(name,args);return {data:r.data,error:r.error};}});
    if(tenant.mode!=='tenant') throw new Error('This portal could not be identified.');
    const row=await db.from('client_websites').select('organization_id').eq('id',tenant.website_id).single();
    if(row.error || !row.data?.organization_id) throw new Error('This portal has no authorized organization.');
    org=row.data.organization_id;
  }
  let query=db.from('ra_workspaces').select('id,organization_id,name');
  if(org) query=query.eq('organization_id',org);
  if(params.get('organization_product')) query=query.eq('id',params.get('organization_product')!);
  const rows=await query;
  if(rows.error) throw new Error('Resource Availability could not be loaded. Please try again.');
  if(rows.data?.length!==1) throw new Error('Open Resource Availability from your organization’s portal. Access must be enabled by an administrator.');
  return new LiveStore(db,rows.data[0]!);
}
class LiveStore implements Store {
  constructor(private db:SupabaseClient,private workspace:Snapshot['workspace']) {}
  async archive(f:ArchiveFilters):Promise<ArchivePage>{
    const session=await this.db.auth.getUser();if(session.error||!session.data.user)throw new Error('Sign in through the portal to continue.');
    let query=this.db.from('ra_archived_reports').select('id,source_created_at,agency_name,submitted_by,raw',{count:'exact'}).eq('workspace_id',this.workspace.id);
    if(f.year)query=query.gte('source_created_at',`${f.year}-01-01`).lt('source_created_at',`${Number(f.year)+1}-01-01`);
    if(f.agency==='__missing')query=query.is('agency_name',null);else if(f.agency)query=query.eq('agency_name',f.agency);
    if(f.from)query=query.gte('source_created_at',f.from);
    if(f.to)query=query.lte('source_created_at',`${f.to}T23:59:59.999999`);
    const [reports,batches]=await Promise.all([query.order('source_created_at',{ascending:false}).order('id').range(f.page*50,f.page*50+49),this.db.from('ra_archive_batches').select('metadata').eq('workspace_id',this.workspace.id)]);
    if(reports.error||batches.error)throw reports.error||batches.error;
    return {rows:reports.data||[],total:reports.count||0,batches:batches.data||[]};
  }
  onSignedOut(callback:()=>void){const {data}=this.db.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')callback();});return ()=>data.subscription.unsubscribe();}
  async load(): Promise<Snapshot> {
    const session=await this.db.auth.getUser();if(session.error||!session.data.user)throw new Error('Sign in through the portal to continue.');
    const {data,error}=await this.db.rpc('ra_snapshot',{workspace:this.workspace.id});
    if(error) throw error;
    if(!data?.workspace) throw new Error('Resource Availability access is no longer available.');
    return data as Snapshot;
  }
  async command(action:string,args:Record<string,unknown>) {
    const {data,error}=await this.db.rpc('ra_command',{workspace:this.workspace.id,action,args});
    if(error) throw error; return data;
  }
}
