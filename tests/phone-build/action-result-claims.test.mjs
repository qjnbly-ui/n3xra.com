import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { PhoneBuildConversation } = require('../../api/_phone-build.js');

const tool = (name, args = {}) => ({
  role: 'assistant',
  content: null,
  tool_calls: [{
    id: randomUUID(),
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }],
});

test('an unrouted model-only save claim is replanned into a real publish', async () => {
  const websiteId = randomUUID();
  const calls = [];
  const speech = [];
  const replies = [];
  const session = {
    id: randomUUID(),
    state: 'ready',
    cancellable: false,
    canClose: false,
    codexAuthenticated: true,
  };
  const rpc = async (path, input) => {
    calls.push({ path, input });
    return { session };
  };
  const agent = async (_messages, context) => {
    const reply = replies.shift();
    if (typeof reply === 'function') return reply(context);
    if (!reply) throw new Error('Missing fixture reply.');
    return reply;
  };
  const flow = new PhoneBuildConversation(rpc, text => speech.push(text), websiteId, 'Demo', Date.now, agent);

  try {
    flow.begin();
    replies.push(context => tool('confirm_action', { confirmation_id: context.pending.id }));
    await flow.handle('Yes, that is the website.');

    replies.push({
      role: 'assistant',
      content: 'Your changes have been saved to the main site and are now live.',
    });
    replies.push(tool('execute_action', {action:'save',instruction:''}));
    await flow.handle('Okay. Save.');

    assert.equal(calls.filter(call => /\/(?:save|publish)$/.test(call.path)).length, 0);
    replies.push(context => tool('confirm_action', { confirmation_id: context.pending.id }));
    await flow.handle('Yes, save it.');
    assert.equal(calls.filter(call => /\/(?:save|publish)$/.test(call.path)).length, 1);
    assert.match(speech.at(-1), /Saved to main on GitHub/);
    assert.doesNotMatch(speech.at(-1), /now live/);
  } finally {
    flow.dispose();
  }
});
