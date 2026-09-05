import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {syncWorkingCopy}=createRequire(import.meta.url)('../../dist/build-worker/workspace-sync.js');

test('sync refuses dirty overwrites and aborts conflicting merges without losing local work',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'studio-sync-'));
 const run=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.test',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.test'}}).trim();
 const git=async args=>run(...args);
 try {
  run('init','-b','main');await writeFile(join(dir,'page.txt'),'original\n');run('add','.');run('commit','-m','original');
  run('checkout','-b','external');await writeFile(join(dir,'page.txt'),'external edit\n');run('commit','-am','external');run('update-ref','refs/remotes/origin/main','HEAD');
  run('checkout','main');run('checkout','-b','work');await writeFile(join(dir,'page.txt'),'unfinished\n');
  await assert.rejects(syncWorkingCopy(git,'main','work'),/save a checkpoint/);assert.match(run('diff'),/unfinished/);
  run('commit','-am','local work');const head=run('rev-parse','HEAD');
  await assert.rejects(syncWorkingCopy(git,'main','work'),/could not be combined safely/);
  assert.equal(run('rev-parse','HEAD'),head);assert.equal(run('status','--porcelain'),'');assert.equal(run('show','HEAD:page.txt'),'unfinished');
 } finally {await rm(dir,{recursive:true,force:true});}
});
