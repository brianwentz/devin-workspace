import { describe, expect, it } from 'vitest';
import {
  applyUpdate,
  clearPermission,
  emptyLocalState,
  finishPrompt,
  newSession,
  removeWorkspace,
  resetHistory,
  sessionsFor,
  setPermission,
  startPrompt,
  titleFromPrompt,
  upsertAgent,
  upsertSession,
  type LocalState,
} from '../../src/core/localModel';

const SID = 'sess-1';
const WS = 'C:\\work\\repo';

function withSession(): LocalState {
  const state = emptyLocalState('devin');
  return {
    ...state,
    sessions: { [SID]: newSession({ id: SID, workspace: WS, createdAt: '2026-10-01T00:00:00Z' }) },
  };
}

function text(t: string) {
  return { type: 'text' as const, text: t };
}

describe('localModel reducers', () => {
  it('ignores updates for unknown sessions', () => {
    const state = withSession();
    expect(
      applyUpdate(state, 'nope', { sessionUpdate: 'agent_message_chunk', content: text('x') }),
    ).toBe(state);
  });

  it('startPrompt adds a user message, sets running and a title from the first prompt', () => {
    const state = startPrompt(withSession(), SID, 'Hello   there, Devin — please fix the build');
    const session = state.sessions[SID]!;
    expect(session.running).toBe(true);
    expect(session.messages).toEqual([
      { role: 'user', blocks: [{ type: 'text', text: 'Hello   there, Devin — please fix the build' }] },
    ]);
    expect(session.title).toBe('Hello there, Devin — please fix the build');
    const second = startPrompt(finishPrompt(state, SID, 'end_turn'), SID, 'second');
    expect(second.sessions[SID]!.title).toBe('Hello there, Devin — please fix the build');
    expect(second.sessions[SID]!.lastStopReason).toBeUndefined();
  });

  it('titleFromPrompt truncates to 60 chars with an ellipsis', () => {
    const long = 'a'.repeat(100);
    expect(titleFromPrompt(long)).toHaveLength(60);
    expect(titleFromPrompt(long).endsWith('…')).toBe(true);
    expect(titleFromPrompt('short')).toBe('short');
  });

  it('concatenates agent_message_chunk text into one block and starts an agent message', () => {
    let state = startPrompt(withSession(), SID, 'hi');
    state = applyUpdate(state, SID, { sessionUpdate: 'agent_message_chunk', content: text('p') });
    state = applyUpdate(state, SID, { sessionUpdate: 'agent_message_chunk', content: text('o') });
    state = applyUpdate(state, SID, { sessionUpdate: 'agent_message_chunk', content: text('ng') });
    const messages = state.sessions[SID]!.messages;
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({ role: 'agent', blocks: [{ type: 'text', text: 'pong' }] });
  });

  it('keeps thought chunks in separate thought blocks and concatenates consecutive thoughts', () => {
    let state = startPrompt(withSession(), SID, 'hi');
    state = applyUpdate(state, SID, { sessionUpdate: 'agent_thought_chunk', content: text('think ') });
    state = applyUpdate(state, SID, { sessionUpdate: 'agent_thought_chunk', content: text('hard') });
    state = applyUpdate(state, SID, { sessionUpdate: 'agent_message_chunk', content: text('answer') });
    state = applyUpdate(state, SID, { sessionUpdate: 'agent_thought_chunk', content: text('later') });
    expect(state.sessions[SID]!.messages[1]!.blocks).toEqual([
      { type: 'thought', text: 'think hard' },
      { type: 'text', text: 'answer' },
      { type: 'thought', text: 'later' },
    ]);
  });

  it('splits agent messages when messageId changes', () => {
    let state = withSession();
    state = applyUpdate(state, SID, {
      sessionUpdate: 'agent_message_chunk',
      content: text('one'),
      messageId: 'm1',
    });
    state = applyUpdate(state, SID, {
      sessionUpdate: 'agent_message_chunk',
      content: text('two'),
      messageId: 'm2',
    });
    expect(state.sessions[SID]!.messages.map((m) => m.blocks[0])).toEqual([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
    ]);
  });

  it('user_message_chunk during replay creates user messages and derives the title', () => {
    let state = withSession();
    state = applyUpdate(state, SID, { sessionUpdate: 'user_message_chunk', content: text('Reply with pong') });
    state = applyUpdate(state, SID, { sessionUpdate: 'agent_message_chunk', content: text('pong') });
    state = applyUpdate(state, SID, { sessionUpdate: 'user_message_chunk', content: text('again') });
    const session = state.sessions[SID]!;
    expect(session.title).toBe('Reply with pong');
    expect(session.messages.map((m) => m.role)).toEqual(['user', 'agent', 'user']);
  });

  it('ignores user_message_chunk echoes while a prompt is running', () => {
    let state = startPrompt(withSession(), SID, 'hello');
    const before = state;
    state = applyUpdate(state, SID, { sessionUpdate: 'user_message_chunk', content: text('hello') });
    expect(state).toBe(before);
    state = finishPrompt(state, SID, 'end_turn');
    state = applyUpdate(state, SID, { sessionUpdate: 'user_message_chunk', content: text('replayed') });
    expect(state.sessions[SID]!.messages.map((m) => m.blocks[0])).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'replayed' },
    ]);
  });

  it('renders non-text content blocks as placeholders', () => {
    let state = withSession();
    state = applyUpdate(state, SID, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'image', data: '', mimeType: 'image/png' },
    });
    state = applyUpdate(state, SID, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'resource_link', uri: 'https://github.com/x/y', name: 'repo' },
    });
    expect(state.sessions[SID]!.messages[0]!.blocks[0]).toEqual({
      type: 'text',
      text: '[image][repo](https://github.com/x/y)',
    });
  });

  it('tool_call creates a card and a tool_call block; tool_call_update merges fields', () => {
    let state = startPrompt(withSession(), SID, 'hi');
    state = applyUpdate(state, SID, {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc1',
      title: 'Read file',
      kind: 'read',
      status: 'pending',
      rawInput: { path: 'a.ts' },
    });
    expect(state.sessions[SID]!.toolCalls.tc1).toEqual({
      id: 'tc1',
      title: 'Read file',
      kind: 'read',
      status: 'pending',
      rawInput: { path: 'a.ts' },
    });
    expect(state.sessions[SID]!.messages[1]!.blocks).toEqual([{ type: 'tool_call', id: 'tc1' }]);

    state = applyUpdate(state, SID, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc1',
      status: 'completed',
      title: null,
      content: [{ type: 'content', content: text('done') }],
      rawOutput: 'ok',
    });
    expect(state.sessions[SID]!.toolCalls.tc1).toEqual({
      id: 'tc1',
      title: 'Read file',
      kind: 'read',
      status: 'completed',
      rawInput: { path: 'a.ts' },
      rawOutput: 'ok',
      content: [{ type: 'content', content: text('done') }],
    });
    // Still a single block reference.
    expect(state.sessions[SID]!.messages[1]!.blocks).toHaveLength(1);
  });

  it('tool_call_update for an unknown id creates the card and block', () => {
    let state = withSession();
    state = applyUpdate(state, SID, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'orphan',
      status: 'in_progress',
    });
    expect(state.sessions[SID]!.toolCalls.orphan).toEqual({
      id: 'orphan',
      title: 'orphan',
      status: 'in_progress',
    });
    expect(state.sessions[SID]!.messages[0]).toEqual({
      role: 'agent',
      blocks: [{ type: 'tool_call', id: 'orphan' }],
    });
  });

  it('tool_call blocks interleave with text in the same agent message', () => {
    let state = withSession();
    state = applyUpdate(state, SID, { sessionUpdate: 'agent_message_chunk', content: text('before') });
    state = applyUpdate(state, SID, { sessionUpdate: 'tool_call', toolCallId: 't', title: 'T' });
    state = applyUpdate(state, SID, { sessionUpdate: 'agent_message_chunk', content: text('after') });
    expect(state.sessions[SID]!.messages).toHaveLength(1);
    expect(state.sessions[SID]!.messages[0]!.blocks).toEqual([
      { type: 'text', text: 'before' },
      { type: 'tool_call', id: 't' },
      { type: 'text', text: 'after' },
    ]);
  });

  it('plan replaces the previous plan', () => {
    let state = withSession();
    state = applyUpdate(state, SID, {
      sessionUpdate: 'plan',
      entries: [{ content: 'a', priority: 'high', status: 'pending' }],
    });
    state = applyUpdate(state, SID, {
      sessionUpdate: 'plan',
      entries: [
        { content: 'a', priority: 'high', status: 'completed' },
        { content: 'b', priority: 'low', status: 'in_progress' },
      ],
    });
    expect(state.sessions[SID]!.plan).toEqual([
      { content: 'a', priority: 'high', status: 'completed' },
      { content: 'b', priority: 'low', status: 'in_progress' },
    ]);
  });

  it('session_info_update sets the title; unknown updates are ignored', () => {
    let state = withSession();
    const before = state;
    state = applyUpdate(state, SID, { sessionUpdate: 'usage_update', used: 1, size: 2 });
    expect(state).toBe(before);
    state = applyUpdate(state, SID, { sessionUpdate: 'session_info_update', title: 'Named' });
    expect(state.sessions[SID]!.title).toBe('Named');
    expect(applyUpdate(state, SID, { sessionUpdate: 'session_info_update', title: null })).toBe(state);
  });

  it('setPermission / clearPermission', () => {
    const permission = {
      requestId: 'r1',
      toolCallId: 'tc1',
      title: 'Run command',
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    };
    let state = setPermission(withSession(), SID, permission);
    expect(state.sessions[SID]!.pendingPermission).toEqual(permission);
    const cleared = clearPermission(state, SID);
    expect(cleared.sessions[SID]!.pendingPermission).toBeUndefined();
    expect(clearPermission(cleared, SID)).toBe(cleared);
    expect(setPermission(state, 'nope', permission)).toBe(state);
  });

  it('finishPrompt records each stopReason, clears running and pending permission', () => {
    for (const reason of ['end_turn', 'cancelled', 'max_tokens', 'refusal', 'max_turn_requests'] as const) {
      let state = startPrompt(withSession(), SID, 'go');
      state = setPermission(state, SID, { requestId: 'r', toolCallId: 't', title: 'x', options: [] });
      state = finishPrompt(state, SID, reason);
      const session = state.sessions[SID]!;
      expect(session.running).toBe(false);
      expect(session.lastStopReason).toBe(reason);
      expect(session.pendingPermission).toBeUndefined();
      expect(session.error).toBeUndefined();
    }
    const failed = finishPrompt(startPrompt(withSession(), SID, 'go'), SID, 'error', 'agent crashed');
    expect(failed.sessions[SID]!.lastStopReason).toBe('error');
    expect(failed.sessions[SID]!.error).toBe('agent crashed');
  });

  it('resetHistory clears messages, tool calls and plan but keeps metadata', () => {
    let state = startPrompt(withSession(), SID, 'hi');
    state = applyUpdate(state, SID, { sessionUpdate: 'tool_call', toolCallId: 't', title: 'T' });
    state = applyUpdate(state, SID, { sessionUpdate: 'plan', entries: [] });
    const reset = resetHistory(state, SID).sessions[SID]!;
    expect(reset.messages).toEqual([]);
    expect(reset.toolCalls).toEqual({});
    expect(reset.plan).toBeUndefined();
    expect(reset.title).toBe('hi');
    expect(reset.loaded).toBe(true);
  });

  it('upsertSession adds new entries and only refreshes metadata of existing ones', () => {
    let state = startPrompt(withSession(), SID, 'hi');
    state = upsertSession(
      state,
      newSession({ id: SID, workspace: WS, title: 'From agent', historySource: 'agent', loaded: false }),
    );
    expect(state.sessions[SID]!.messages).toHaveLength(1);
    expect(state.sessions[SID]!.title).toBe('hi');
    state = upsertSession(
      state,
      newSession({ id: 'other', workspace: WS, title: 'Older', createdAt: '2020-01-01T00:00:00Z', historySource: 'local-index', loaded: false }),
    );
    expect(state.sessions.other!.historySource).toBe('local-index');
    expect(sessionsFor(state, WS).map((s) => s.id)).toEqual([SID, 'other']);
    expect(sessionsFor(state, 'elsewhere')).toEqual([]);
  });

  it('upsertAgent creates and patches agents, dropping cleared error/retry fields', () => {
    let state = upsertAgent(emptyLocalState('devin'), WS, { status: 'starting' });
    expect(state.agents[WS]).toEqual({ workspace: WS, status: 'starting', restarts: 0 });
    state = upsertAgent(state, WS, {
      status: 'ready',
      protocolVersion: 1,
      capabilities: { loadSession: true, sessionList: false },
    });
    expect(state.agents[WS]!.capabilities).toEqual({ loadSession: true, sessionList: false });
    state = upsertAgent(state, WS, { status: 'crashed', error: 'exit 1', retryInMs: 1000, restarts: 1 });
    expect(state.agents[WS]!.error).toBe('exit 1');
    state = upsertAgent(state, WS, { status: 'ready', error: undefined, retryInMs: undefined });
    expect(state.agents[WS]!.error).toBeUndefined();
    expect(state.agents[WS]!.retryInMs).toBeUndefined();
    expect(state.agents[WS]!.restarts).toBe(1);
  });

  it('removeWorkspace drops the agent and its sessions', () => {
    let state = upsertAgent(withSession(), WS, { status: 'ready' });
    state = upsertSession(state, newSession({ id: 'keep', workspace: 'D:\\other' }));
    state = removeWorkspace(state, WS);
    expect(state.agents[WS]).toBeUndefined();
    expect(Object.keys(state.sessions)).toEqual(['keep']);
  });

  it('emptyLocalState carries install guidance when the CLI is missing', () => {
    expect(emptyLocalState(null).installGuidance).toContain('docs.devin.ai/desktop');
    expect(emptyLocalState('C:\\devin.exe').installGuidance).toBe('');
  });
});
