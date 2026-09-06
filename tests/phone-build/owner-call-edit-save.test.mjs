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

test('owner call edits, waits, reviews, confirms one main save, and closes', async () => {
  let now = 100_000;
  let state = {
    id: randomUUID(),
    state: 'ready',
    codexAuthenticated: true,
    canClose: false,
    changedFileCount: 0,
  };
  let latestReply = { id: 'historical', message: 'An older reply.' };
  const calls = [];
  const speech = [];
  const plans = [];

  const rpc = async (path, input) => {
    calls.push({ path, input });
    if (path === '/v1/projects/open') return { session: { ...state } };
    if (path.endsWith('/messages')) {
      state = { ...state, state: 'working', canClose: false, changedFileCount: 1 };
      return { accepted: true };
    }
    if (path.endsWith('/publish')) {
      state = { ...state, state: 'ready', canClose: true, changedFileCount: 0 };
      return { session: { ...state } };
    }
    if (path.endsWith('/close')) {
      state = { ...state, state: 'stopped', canClose: false };
      return { session: { ...state } };
    }
    return { session: { ...state }, latestReply };
  };
  const agent = async (messages, context, signal) => {
    const plan = plans.shift();
    if (!plan) throw new Error('Missing planned provider response.');
    return typeof plan === 'function' ? plan(messages, context, signal) : plan;
  };
  const flow = new PhoneBuildConversation(rpc, message => speech.push(message), randomUUID(), 'Demo', () => now, agent);
  const handle = async (text, ...responses) => {
    plans.push(...responses);
    await flow.handle(text);
  };

  try {
    flow.begin();
    await handle('Yes.', (_messages, context) => tool('confirm_action', { confirmation_id: context.pending.id }));

    const edit = 'On the homepage, replace the polar bear with a goldfish.';
    await handle("I'd like to remove the polar bear and replace it with a goldfish.", tool('execute_action', {
      action: 'edit',
      instruction: edit,
    }));
    const builderCalls = calls.filter(call => call.path.endsWith('/messages'));
    assert.equal(builderCalls.length, 1);
    assert.equal(builderCalls[0].input.text, edit);
    assert.doesNotMatch(builderCalls[0].input.text, /Caller-requested outcome|Original caller statements|authoritative intent|external URL/i);

    const plainProviderReply = "Okay, I'll let the builder work.";
    await handle("We'll just wait.", { role: 'assistant', content: plainProviderReply }, messages => {
      assert.ok(messages.some(message => message.role === 'assistant' && message.content === plainProviderReply),
        'the provider retry should retain the response it needs to convert into a tool call');
      return tool('respond', { text: 'Okay. I will let the builder work.' });
    });
    await handle("I'll just wait until you're ready.", tool('respond', { text: 'Of course. I will let you know when it is ready.' }));
    assert.equal(calls.filter(call => /\/(?:messages|publish|save|close)$/.test(call.path)).length, 1);
    assert.ok(!speech.some(message => /could not finish interpreting/i.test(message)));

    state = { ...state, state: 'ready', canClose: false, changedFileCount: 1 };
    latestReply = { id: 'goldfish-finished', message: 'The homepage now shows a goldfish in place of the polar bear.' };
    now += 31_000;
    await flow.poll();
    assert.equal(speech.at(-1), latestReply.message);

    await handle('Okay. It looks good.', (_messages, context) => {
      assert.equal(context.hasUnsavedChanges, true);
      assert.equal(context.canClose, false);
      return tool('respond', {
        text: 'Great. Would you like another change, or should I save these changes?',
      });
    });
    assert.match(speech.at(-1), /another change.*save/i);
    assert.equal(calls.filter(call => /\/(?:publish|save)$/.test(call.path)).length, 0,
      'praise alone must not save');

    await handle('Save.', (_messages, context) => {
      assert.equal(context.saveDestination, 'main');
      return tool('request_save');
    });
    assert.equal(speech.at(-1), 'Save these changes to the live site?');
    assert.equal(speech.filter(message => message === 'Save these changes to the live site?').length, 1);
    assert.equal(calls.filter(call => /\/(?:publish|save)$/.test(call.path)).length, 0,
      'the save confirmation must precede the mutation');

    await handle('Yes.', (_messages, context) => tool('confirm_action', { confirmation_id: context.pending.id }));
    assert.equal(calls.filter(call => call.path.endsWith('/publish')).length, 1);
    assert.match(speech.at(-1), /Saved to main on GitHub/);
    assert.doesNotMatch(speech.at(-1), /deployed|now live/i);

    await handle("Okay. We're done.", (_messages, context) => {
      assert.equal(context.hasUnsavedChanges, false);
      assert.equal(context.canClose, true);
      return tool('execute_action', { action: 'close' });
    });
    assert.equal(calls.filter(call => call.path.endsWith('/close')).length, 1);
    assert.equal(speech.at(-1), 'Project closed. Your work is saved on GitHub.');
    assert.equal(flow.active, false);
    assert.ok(!speech.some(message => /could not finish interpreting/i.test(message)));
  } finally {
    flow.dispose();
  }
});
