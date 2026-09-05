import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const file = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const helpers = await import(`data:text/javascript;base64,${Buffer.from(await file('client-portal/private-products.js')).toString('base64')}`);
const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const product = { id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',organization_id:org,name:'Private tool',description:'Team workspace',status:'active',app_path:'/client-portal/private-tool/' };
const source = (await file('client-portal/portal-apps.js')).replace(/^import .*$/gm,'').split('void loadPortalApps().catch')[0] + '\nglobalThis.run = loadPortalApps;';
function context({admin=false,tenant=true,search='',signedIn=true,privateError=false}={}) {
 const calls=[]; const redirects=[];
 const grid={innerHTML:'',hasAttribute:()=>true,addEventListener(){}};
 const status={hidden:false,textContent:''}; const title={textContent:''};
 const datasets={client_websites:[{id:'website',organization_id:org}],organizations:[{id:org,name:'Example Organization'}],website_portal_features:[],organization_product_entitlements:[],organization_product_member_access:[],organization_private_products:[product,{...product,id:'other',organization_id:other,name:'Other organization tool'}]};
 const client={from(table){let rows=datasets[table]||[];const query={select(){return query},eq(key,value){calls.push([table,key,value]);rows=rows.filter(row=>row[key]===value);return query},in(){return query},order(){return query},maybeSingle(){return Promise.resolve({data:rows[0]||null,error:null})},single(){return Promise.resolve({data:rows[0]||null,error:null})},then(resolve){resolve({data:rows,error:table==='organization_private_products'&&privateError?new Error('Private apps unavailable'):null})}};return query},rpc(name){return Promise.resolve({data:name==='is_platform_admin'?admin:{can_manage:false},error:null})}};
 const location={search,pathname:'/client-portal/organization/',hash:'',origin:'https://example.portal.n3xra.com',replace:value=>redirects.push(value)};
 const sandbox={...helpers,createBrowserSupabase:()=>client,getSessionOrNull:async()=>signedIn?{user:{id:'member'}}:null,hasConfig:()=>true,setStoredActiveOrganizationId(){},resolvePortalTenant:async()=>tenant?{mode:'tenant',website_id:'website'}:{mode:'unbound'},isBrandedPortalHostname:()=>tenant,document:{querySelector(selector){return {'#portal-app-grid':grid,'#portal-app-status':status,'#organization-name':title,'#organization-preview':{removeAttribute(){}}}[selector]||null}},window:{location},location,URL,URLSearchParams,console};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);
 return {run:sandbox.run,grid,status,title,calls,redirects};
}
test('private links preserve organization and product IDs and reject unsafe routes',()=>{
 const safe=helpers.privateProductPath(product.app_path,org,product.id);
 assert.equal(new URL(safe,'https://example.com').searchParams.get('organization'),org);
 assert.equal(new URL(safe,'https://example.com').searchParams.get('organization_product'),product.id);
 for(const path of ['https://other.com','//other.com','/\\other.com','/app?next=x','/app#fragment','/../admin','/%2fother.com','/app name']) assert.equal(helpers.privateProductPath(path,org,product.id),'',path);
});
test('branded organization portal ignores a tampered organization parameter',async()=>{
 const c=context({search:`?organization=${other}`});await c.run();
 assert.match(c.grid.innerHTML,/Private tool/);assert.doesNotMatch(c.grid.innerHTML,/Other organization tool/);
 assert.ok(c.calls.some(([table,key,value])=>table==='organization_private_products'&&key==='organization_id'&&value===org));
 assert.match(c.grid.innerHTML,new RegExp(`organization=${org}`));assert.equal(c.redirects.length,0);
});
test('organization preview requires platform administrator access on an unbound host',async()=>{
 const c=context({tenant:false,search:`?organization=${org}`});await assert.rejects(c.run(),/website sign-in/);
 assert.equal(c.calls.length,0);
});
test('authorized administrator preview stays on the organization landing page',async()=>{
 const c=context({tenant:false,admin:true,search:`?organization=${org}`});await c.run();assert.match(c.grid.innerHTML,/Private tool/);assert.equal(c.title.textContent,'Example Organization');assert.equal(c.redirects.length,0);
});
test('signed-out organization visitors are sent to sign-in',async()=>{
 const c=context({signedIn:false});await c.run();assert.match(c.redirects[0],/^\/client-portal\/login\//);assert.equal(c.grid.innerHTML,'');
});
test('a private product query failure cannot display a partial product list',async()=>{
 const c=context({privateError:true});await assert.rejects(c.run(),/Private apps unavailable/);assert.equal(c.grid.innerHTML,'');
});
