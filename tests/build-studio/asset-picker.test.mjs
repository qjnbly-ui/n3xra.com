import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
async function fixture(){
 const source=(await fs.readFile('n3xra-admin/build-studio/asset-picker.js','utf8')).replace(/^export /gm,'');
 const elements=new Map(); const element=()=>({children:[],append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},setAttribute(){},focus(){}});
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)};
 const channels=[],opened=[];let website={id:'demo',organization_id:'org'};
 const ctx={document:{querySelector:get,createElement:element},window:{open(...args){opened.push(args)}},crypto:{randomUUID:()=> 'test-channel'},BroadcastChannel:class{constructor(name){this.name=name;channels.push(this)}close(){this.closed=true}postMessage(v){this.sent=v}},encodeURIComponent};
 vm.createContext(ctx); vm.runInContext(source+'\nglobalThis.setup=setupAssetPicker;',ctx);
 const picker=ctx.setup({},'user',()=>website,element());
 return {picker,get,channels,opened,switchSite(){website={id:'other'}}};
}
test('opens the actual admin Files & Assets page with website and private return channel',async()=>{
 const f=await fixture();f.get('#build-upload-files').onclick();
 assert.equal(f.opened[0][0],'/n3xra-admin/assets/?website=demo&buildStudio=test-channel');
 assert.equal(f.opened[0][2],'noopener');
});
test('accepts selected public links, rejects another website and unsafe URLs, clears attachments',async()=>{
 const f=await fixture();f.get('#build-upload-files').onclick();const channel=f.channels[0];
 channel.onmessage({data:{type:'selected',websiteId:'other',files:[{id:'x',name:'x',publicUrl:'https://cdn.test/x'}]}});
 assert.equal(f.picker.context(),'');
 channel.onmessage({data:{type:'selected',websiteId:'demo',files:[{id:'bad',name:'bad',publicUrl:'javascript:alert(1)'},{id:'ok',name:'Photo',publicUrl:'https://cdn.test/photo'}]}});
 assert.match(f.picker.context(),/https:\/\/cdn.test\/photo/);assert.doesNotMatch(f.picker.context(),/javascript/);
 assert.equal(channel.sent.type,'received');f.picker.clear();assert.equal(f.picker.context(),'');
});
test('switching websites invalidates old selections and reset closes the channel',async()=>{
 const f=await fixture();f.get('#build-upload-files').onclick();const channel=f.channels[0];f.switchSite();
 channel.onmessage({data:{type:'selected',websiteId:'demo',files:[{id:'ok',name:'Photo',publicUrl:'https://cdn.test/photo'}]}});
 assert.equal(f.picker.context(),'');f.picker.reset();assert.equal(channel.closed,true);
});
