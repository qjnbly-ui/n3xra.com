import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
const source=readFileSync(new URL('../../maps-app/src/lib/valve-branches.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {valveBranches}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('cross junction offers four directional branches without changing lines',()=>{
 const lines=[{id:'a',coordinates:[[-.001,0],[.001,0]]},{id:'b',coordinates:[[0,-.001],[0,.001]]}];
 const original=JSON.stringify(lines);
 const branches=valveBranches(lines,[0,0]);
 assert.equal(branches.length,4);
 assert.deepEqual(branches.map(b=>b.direction).sort(),['east','north','south','west']);
 assert.equal(JSON.stringify(lines),original);
});
test('tee has three branches and no zero-length endpoint choice',()=>{
 const branches=valveBranches([{id:'a',coordinates:[[-.001,0],[.001,0]]},{id:'b',coordinates:[[0,0],[0,.001]]}],[0,0]);
 assert.equal(branches.length,3);
 assert.ok(!branches.some(b=>b.direction==='south'));
});
test('curved branch retains vertices and follows initial direction away from junction',()=>{
 const branches=valveBranches([{id:'a',coordinates:[[0,0],[0,.001],[.001,.001]]}],[0,0]);
 assert.equal(branches.length,1);
 assert.equal(branches[0].direction,'north');
 assert.deepEqual(branches[0].coordinates,[[0,0],[0,.001],[.001,.001]]);
});
test('unrelated lines and degenerate paths produce no branch',()=>{
 assert.deepEqual(valveBranches([{id:'a',coordinates:[[1,1],[1,2]]},{id:'b',coordinates:[[0,0],[0,0]]}],[0,0]),[]);
});
