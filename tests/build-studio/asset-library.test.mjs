import test from 'node:test';
import assert from 'node:assert/strict';
import { fileMime, listAssetFiles, publishAssetFile, useAssetFile } from '../../n3xra-admin/build-studio/asset-library.js';
const site = { id:'demo-site', organization_id:'demo-org', name:'Demo' };
function mockDb(failAt = '') {
  const calls=[];
  const result=(key,data=null)=>({data,error:key===failAt?{message:'Deliberate failure'}:null});
  const db={from(table){ return {
    insert(row){calls.push([table,'insert',row]);return Promise.resolve(result(table+':insert'));},
    update(row){return {eq(key,value){calls.push([table,'update',row,key,value]);return Promise.resolve(result(table+':update'));}};},
    delete(){return {eq(key,value){calls.push([table,'delete',key,value]);return Promise.resolve(result(table+':delete'));}};},
  };},storage:{from(bucket){return {
    upload(path,file,options){calls.push([bucket,'upload',path,file.size,options]);return Promise.resolve(result(bucket+':upload'));},
    remove(paths){calls.push([bucket,'remove',paths]);return Promise.resolve(result(bucket+':remove'));},
    getPublicUrl(path){return {data:{publicUrl:'https://cdn.example/'+path}};},
    download(path){calls.push([bucket,'download',path]);return Promise.resolve(result(bucket+':download',new Blob(['hello'])));},
  };}}};
  return {db,calls};
}
test('rejects executable/HTML files and oversized files before mutations',async()=>{
  const {db,calls}=mockDb();
  assert.throws(()=>fileMime('large.png',51*1024*1024),/50 MB/);
  await assert.rejects(()=>publishAssetFile(db,site,'owner',new File(['<html>'],'unsafe.html')),/choose an image/);
  assert.equal(calls.length,0);
});
test('upload keeps a private original, publishes a unique website path, and registers library version',async()=>{
  const {db,calls}=mockDb();
  const file=await publishAssetFile(db,site,'owner',new File(['pdf'],'guide.pdf'));
  assert.match(file.publicUrl,/^https:\/\/cdn.example\/demo-site\//);
  const asset=calls.find(c=>c[0]==='website_assets'&&c[1]==='insert')[2];
  assert.equal(asset.website_id,site.id); assert.equal(asset.created_by_user_id,'owner');
  assert.equal(asset.replacement_type,'download_only');
  assert.equal(calls.filter(c=>c[1]==='upload').length,2);
  assert.equal(calls.find(c=>c[0]==='website_asset_versions'&&c[1]==='insert')[2].status,'approved');
  assert.equal(calls.find(c=>c[0]==='website_asset_versions'&&c[1]==='update')[2].status,'published');
});
test('a failed public upload removes only the newly-created original and asset',async()=>{
  const {db,calls}=mockDb('website-assets-public:upload');
  await assert.rejects(()=>publishAssetFile(db,site,'owner',new File(['png'],'logo.png')),/Deliberate failure/);
  assert.ok(calls.some(c=>c[0]==='website-assets-private'&&c[1]==='remove'));
  assert.ok(calls.some(c=>c[0]==='website_assets'&&c[1]==='delete'));
  assert.ok(!calls.some(c=>c[0]==='website-assets-public'&&c[1]==='remove'));
});
test('a failed registration after publishing removes public and private copies',async()=>{
  const {db,calls}=mockDb('website_asset_versions:update');
  await assert.rejects(()=>publishAssetFile(db,site,'owner',new File(['png'],'logo.png')));
  assert.equal(calls.filter(c=>c[1]==='remove').length,2);
});
test('existing public assets reuse their URL without uploading or mutating records',async()=>{
  const {db,calls}=mockDb(); const f={id:'existing',name:'logo.png',size:5,bucket:'website-assets-private',path:'existing',mime:'image/png',publicUrl:'https://cdn.example/a.png'};
  assert.equal(await useAssetFile(db,site,'owner',f),f); assert.deepEqual(calls,[]);
});
test('private source is downloaded but never changed when creating website copy',async()=>{
  const {db,calls}=mockDb();
  await useAssetFile(db,site,'owner',{id:'private',name:'logo.png',size:5,bucket:'organization-files-private',path:'org/original',mime:'image/png'});
  assert.deepEqual(calls.filter(c=>c[0]==='organization-files-private'),[['organization-files-private','download','org/original']]);
});
test('library scopes private files and website discovery to selected organization',async()=>{
  const calls=[];
  const db={from(table){return {select(){return {eq(key,value){calls.push([table,key,value]);return {order(){return Promise.resolve({data:[],error:null});},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};}};}};}};
  assert.deepEqual(await listAssetFiles(db,site),[]);
  assert.deepEqual(calls,[['organization_files','organization_id','demo-org'],['client_websites','organization_id','demo-org']]);
});
