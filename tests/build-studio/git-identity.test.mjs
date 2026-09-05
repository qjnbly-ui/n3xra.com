import test from 'node:test';
import assert from 'node:assert/strict';
import {gitCommitIdentity} from '../../dist/build-worker/git-identity.js';
test('checkpoints require an explicit identity instead of an unmapped generic author',()=>{
 assert.throws(()=>gitCommitIdentity({}),/verified GitHub/);
 assert.throws(()=>gitCommitIdentity({N3XRA_BUILD_GIT_AUTHOR_NAME:'Owner',N3XRA_BUILD_GIT_AUTHOR_EMAIL:'invalid'}),/verified GitHub/);
 const identity=gitCommitIdentity({N3XRA_BUILD_GIT_AUTHOR_NAME:'Owner',N3XRA_BUILD_GIT_AUTHOR_EMAIL:'123+owner@users.noreply.github.com',GIT_AUTHOR_EMAIL:'wrong@example.test'});
 assert.equal(identity.GIT_AUTHOR_EMAIL,'123+owner@users.noreply.github.com');assert.equal(identity.GIT_COMMITTER_EMAIL,identity.GIT_AUTHOR_EMAIL);
});
