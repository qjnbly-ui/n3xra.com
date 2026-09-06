import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isBrandedPortalHostname, resolvePortalTenant, portalLoginUrl } from '../../../src/client-portal/tenant-context';
import { type Snapshot } from './model';

export interface Store { load(): Promise<Snapshot>; command(action: string, args: Record<string,unknown>): Promise<unknown>; onSignedOut?:(callback:()=>void)=>()=>void }
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

