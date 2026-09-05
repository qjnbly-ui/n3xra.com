import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const file = path => readFile(new URL(`../../${path}`,import.meta.url),'utf8');
const teamSource=(await file('client-portal/team.js')).replace(/^import .*$/gm,'').replace('export function startOrganizationTeam','function startOrganizationTeam')+'\nglobalThis.start=startOrganizationTeam;';
function teamHarness(admin) {
 const calls=[];const message={textContent:'',classList:{toggle(){}}};const panel={setAttribute(){},addEventListener(){}};
 const root={querySelector(s){return s==='#team-message'?message:s==='#client-team'?panel:null;}};
 const client={from(){throw new Error('Admin organization selection must not fall back to a website');},rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='is_platform_admin')return {data:admin,error:null};
  if(name==='client_portal_team_snapshot')return {data:{organization:{id:args.input_organization_id,name:'Organization with no website',user_limit:0},members:[],invites:[],can_manage:true},error:null};
  if(name==='client_portal_organization_access_snapshot')return {data:{products:[],member_access:{}},error:null};
  throw Error(name);
 }};
 const context={document:{body:{dataset:{adminView:'organizations'},classList:{remove(){}}},querySelector(){return null}},createBrowserSupabase:()=>client,getSessionOrNull:async()=>({user:{id:'admin'}}),hasConfig:()=>true,URLSearchParams,Intl,Date};
 vm.createContext(context);vm.runInContext(teamSource,context);
 return {start:()=>context.start({root,organizationId:'exact-selected-organization',supabase:client}),calls,message};
}
test('embedded Organization Admin uses the selected organization even without a website',async()=>{
 const h=teamHarness(true);await h.start();assert.equal(h.message.textContent,'');
 const snapshots=h.calls.filter(c=>c.name.endsWith('_snapshot'));assert.equal(snapshots.length,2);
 for(const call of snapshots)assert.equal(call.args.input_organization_id,'exact-selected-organization');
});
test('embedded Organization Admin denies non-platform administrators before loading members',async()=>{
 const h=teamHarness(false);await h.start();assert.match(h.message.textContent,/Platform administrator access is required/);assert.equal(h.calls.length,1);
});
test('organization directory uses workspace classification and has no product-entry form',async()=>{
 const code=await file('client-portal/organizations-admin.js');
 assert.match(code,/\.eq\("workspace_kind", "organization"\)/);
 assert.doesNotMatch(code,/private-product-form|Add private product|data-edit|query\.insert|query\.update/);
 assert.match(code,/Products and workspaces/);assert.match(code,/Preview client view/);assert.match(code,/startOrganizationTeam\(\{ root: host, organizationId: id, supabase \}\)/);
});
test('customer team page still starts its existing team controller',async()=>{
 const source=await file('client-portal/team.js');assert.match(source,/document.body.dataset.adminView !== "organizations"/);assert.match(source,/void startOrganizationTeam\(\)/);
});
