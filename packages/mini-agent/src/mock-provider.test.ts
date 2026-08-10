import { describe, expect, it } from 'vitest';
import { MockModelProvider } from './mock-provider.js';
import type { ModelEvent, ModelRequest } from './types.js';

const proposeTool = {
  name: 'propose_document_patch',
  description: 'propose a patch',
  inputSchema: { type: 'object' },
};

function makeRequest(userText: string, tools = [proposeTool]): ModelRequest {
  return {
    messages: [{ role: 'user', content: userText }],
    tools,
    maxTokens: 8000,
  };
}

async function collect(provider: MockModelProvider, request: ModelRequest): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of provider.stream(request)) {
    events.push(event);
  }
  return events;
}

describe('MockModelProvider', () => {
  it('enters the rewrite branch when the message carries a selection context', async () => {
    const events = await collect(
      new MockModelProvider(),
      makeRequest('User selected text:\n"请修改这段文字"')
    );

    expect(events.some((e) => e.type === 'tool_call_end')).toBe(true);
    expect(events.some((e) => e.type === 'final_answer')).toBe(true);
  });

  it('does NOT enter the rewrite branch when there is no selection context, even with rewrite intent', async () => {
    const events = await collect(new MockModelProvider(), makeRequest('帮我把这段话改得更专业'));

    expect(events.some((e) => e.type === 'tool_call_end')).toBe(false);
    expect(events.some((e) => e.type === 'final_answer')).toBe(true);
  });

  it('stays in the Q&A branch for plain questions without a selection', async () => {
    const events = await collect(new MockModelProvider(), makeRequest('什么是 Yjs？'));

    expect(events.some((e) => e.type === 'tool_call_end')).toBe(false);
    expect(events.some((e) => e.type === 'final_answer')).toBe(true);
  });

  it('yields token events with a per-character delay', async () => {
    const delayMs = 10;
    const provider = new MockModelProvider(delayMs);
    const startedAt = Date.now();
    const events = await collect(provider, makeRequest('User selected text:\n"请修改这段文字"'));
    const elapsed = Date.now() - startedAt;

    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    // each character should be delayed; leave a small tolerance for timer jitter
    expect(elapsed).toBeGreaterThanOrEqual((tokens.length - 1) * delayMs * 0.8);
  });
});
