import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { PhoneBuildConversation, signPhoneRequest, isPhoneBuildRequest } = require('../../api/_phone-build.js');
const { verifyPhoneRequest } = require('../../dist/build-worker/phone-access.js');
const website = randomUUID(), user = randomUUID(), call = 'CA' + 'a'.repeat(32), secret = 'fixture'.repeat(8);

test('phone authorization binds owner, demo, HTTP action, body and expiry; prevents replay', () => {
  const path = '/v1/projects/open', body = JSON.stringify({ websiteId: website });
  const token = signPhoneRequest(user, call, website, 'POST', path, body, secret, 100000);
  assert.throws(() => verifyPhoneRequest(token, 'POST', path, body, secret, randomUUID(), 100000));
  assert.throws(() => verifyPhoneRequest(token, 'POST', path, '{}', secret, website, 100000));
  assert.throws(() => verifyPhoneRequest(token, 'GET', path, body, secret, website, 100000));
  assert.throws(() => verifyPhoneRequest(token, 'POST', path, body, 'other'.repeat(10), website, 100000));
  assert.throws(() => verifyPhoneRequest(token, 'POST', path, body, secret, website, 146000));
  assert.throws(() => verifyPhoneRequest(token, 'POST', path, body, secret, website, 90000));
  assert.equal(verifyPhoneRequest(token, 'POST', path, body, secret, website, 100000).id, user);
  assert.throws(() => verifyPhoneRequest(token, 'POST', path, body, secret, website, 100000), /already received/);
});
test('even signed phone requests cannot publish, login, push, or visit another website', () => {
  for (const path of ['/v1/account/connect', `/v1/sessions/${randomUUID()}/publish`, `/v1/sessions/${randomUUID()}/push`, `/v1/projects/${randomUUID()}/active`]) {
    const method = path.endsWith('active') ? 'GET' : 'POST';
    const token = signPhoneRequest(user, call, website, method, path, '', secret);
    assert.throws(() => verifyPhoneRequest(token, method, path, '', secret, website));
  }
});
function fixture() {
  const calls = [], speech = []; let now = 100000;
  let state = { id: randomUUID(), state: 'ready', cancellable: false, canClose: false, codexAuthenticated: true };
  let event = null; let failure = '';
  const rpc = async (path, input) => {
    calls.push({ path, input });
    if (failure && path.endsWith(failure)) throw new Error('Connection lost');
    if (path.endsWith('/messages')) state = { ...state, state: 'working', cancellable: true };
    if (path.endsWith('/save')) state = { ...state, state: 'ready', canClose: true };
    if (path.endsWith('/cancel')) state = { ...state, state: 'ready', cancellable: false };
    return { session: { ...state }, latestReply: event };
  };
  const flow = new PhoneBuildConversation(rpc, text => speech.push(text), website, 'Demo', () => now);
  return { flow, rpc, calls, speech, setState: v => { state = { ...state, ...v }; }, setEvent: v => { event = v; }, fail: v => { failure = v; }, tick: n => { now += n; } };
}
test('confirm site then edit; duplicate yes cannot resend; progress, cancel, save and close', async () => {
  const f = fixture(); try {
    f.flow.begin(); assert.equal(f.calls.length, 0);
    await f.flow.handle('yes'); assert.equal(f.calls[0].input.websiteId, website);
    await f.flow.handle('Add one rocket'); assert.equal(f.calls.filter(c => c.path.endsWith('/messages')).length, 0);
    await f.flow.handle('yes'); await f.flow.handle('yes');
    assert.equal(f.calls.filter(c => c.path.endsWith('/messages')).length, 1);
    await f.flow.poll(true); assert.match(f.speech.at(-1), /getting ready|working/i);
    await f.flow.handle('cancel'); assert.equal(f.calls.filter(c => c.path.endsWith('/cancel')).length, 1);
    await f.flow.poll(); await f.flow.handle('close'); assert.match(f.speech.at(-1), /Save your work/);
    await f.flow.handle('save'); await f.flow.handle('yes');
    assert.equal(f.calls.filter(c => c.path.endsWith('/save')).length, 1);
    await f.flow.handle('close'); await f.flow.handle('yes'); assert.equal(f.flow.active, false);
  } finally { f.flow.dispose(); }
});
test('lost mutation response is not retried; reconnect reads the same workspace', async () => {
  const f = fixture(); let restored;
  try {
    await f.flow.handle('yes'); // no pending action must do nothing
    assert.equal(f.calls.length, 0);
    f.flow.begin(); await f.flow.handle('yes');
    f.fail('/messages'); await f.flow.handle('Add a rocket'); await f.flow.handle('yes');
    assert.match(f.speech.at(-1), /may still be running/);
    await f.flow.handle('yes'); assert.equal(f.calls.filter(c => c.path.endsWith('/messages')).length, 1);
    f.flow.dispose(); const before = f.calls.length; await f.flow.poll(true); assert.equal(f.calls.length, before);
    restored = new PhoneBuildConversation(f.rpc, m => f.speech.push(m), website);
    restored.begin(); await restored.handle('yes');
    assert.equal(f.calls.filter(c => c.path.endsWith('/messages')).length, 1);
  } finally { f.flow.dispose(); restored?.dispose(); }
});
test('PIN-granted phone window expires; callbacks and live publishing never become edits', async () => {
  const f = fixture(); try {
    f.flow.begin(); await f.flow.handle('yes');
    await f.flow.handle('publish to main'); await f.flow.handle('call me back');
    assert.equal(f.calls.filter(c => c.path.endsWith('/messages')).length, 0);
    f.tick(16 * 60000); await f.flow.handle('Add a rocket'); assert.equal(f.flow.active, false);
    assert.match(f.speech.at(-1), /PIN again/);
  } finally { f.flow.dispose(); }
});
test('pending confirmation suppresses unsolicited progress and failed auth blocks editing', async () => {
  const f = fixture(); try {
    f.flow.begin(); await f.flow.handle('yes'); await f.flow.handle('Add a rocket');
    const n = f.speech.length; await f.flow.poll(); assert.equal(f.speech.length, n);
    await f.flow.handle('no'); f.setState({ codexAuthenticated: false }); await f.flow.poll();
    await f.flow.handle('Add a rocket'); assert.match(f.speech.at(-1), /Connect Codex/);
    await f.flow.handle('yes'); assert.equal(f.calls.filter(c => c.path.endsWith('/messages')).length, 0);
  } finally { f.flow.dispose(); }
});
test('natural phone entry requests are recognized', () => {
  for (const text of ['I want to access Build Studio', 'I want to make a website change', 'Edit my website']) assert.equal(isPhoneBuildRequest(text), true);
  assert.equal(isPhoneBuildRequest('What are your business hours?'), false);
});
test('unsupported requests clear the old confirmation so a later yes cannot execute stale work', async () => {
  const f=fixture();try {
    f.flow.begin();await f.flow.handle('yes');await f.flow.handle('Add a rocket');
    await f.flow.handle('publish to main');await f.flow.handle('yes');
    assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,0);
  } finally {f.flow.dispose();}
});
