import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  parts: [] as Record<string, unknown>[],
  agentOptions: {} as Record<string, unknown>,
  streamOptions: {} as Record<string, unknown>,
}));
vi.mock('ai', () => ({
  tool: (definition: unknown) => definition,
  isStepCount: () => () => false,
  ToolLoopAgent: class {
    constructor(options: Record<string, unknown>) {
      fixture.agentOptions = options;
    }
    async stream(options: Record<string, unknown>) {
      fixture.streamOptions = options;
      return {
        stream: (async function* () {
          for (const part of fixture.parts) yield part;
        })(),
        totalUsage: Promise.resolve({}),
      };
    }
  },
}));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () =>
    Object.assign(() => ({}), { tools: { webSearch: () => ({}) } }),
}));
import { research } from './index.js';
function options() {
  return {
    goal: 'test research',
    apiKey: 'test',
    model: 'test',
    onProgress: vi.fn(async () => {}),
    onDraft: vi.fn(async () => {}),
  };
}
beforeEach(() => {
  fixture.parts = [];
});
describe('durable research streaming', () => {
  it('deduplicates tool starts and sources, ignores reasoning and unsafe links', async () => {
    fixture.parts = [
      { type: 'tool-input-start', id: 's1', toolName: 'web_search' },
      { type: 'tool-call', toolCallId: 's1', toolName: 'web_search' },
      { type: 'tool-call', toolCallId: 'r1', toolName: 'read_page' },
      { type: 'reasoning-delta', text: 'private reasoning' },
      { type: 'source', sourceType: 'url', url: 'javascript:alert(1)' },
      { type: 'source', sourceType: 'url', url: 'invalid url' },
      {
        type: 'source',
        sourceType: 'url',
        url: 'https://example.com',
        title: 'Source',
      },
      {
        type: 'source',
        sourceType: 'url',
        url: 'https://example.com',
        title: 'Source',
      },
      { type: 'text-delta', text: 'Report ' },
      { type: 'text-delta', text: 'content' },
    ];
    const callbacks = options();
    const result = await research(callbacks);
    expect(result.text).toBe('Report content');
    expect(callbacks.onProgress.mock.calls).toHaveLength(3);
    expect(callbacks.onDraft).toHaveBeenLastCalledWith('Report content');
    expect(JSON.stringify(callbacks.onProgress.mock.calls)).not.toContain(
      'private reasoning',
    );
  });
  it('persists the partial report before propagating a stream error', async () => {
    const failure = new Error('Connection lost');
    fixture.parts = [
      { type: 'text-delta', text: 'Partial report' },
      { type: 'error', error: failure },
    ];
    const callbacks = options();
    await expect(research(callbacks)).rejects.toThrow('Connection lost');
    expect(callbacks.onDraft).toHaveBeenLastCalledWith('Partial report');
  });
  it('does not mark an empty response as successful', async () => {
    await expect(research(options())).rejects.toThrow('未生成报告');
  });
  it('rejects competitor reports without an actual web search', async () => {
    fixture.parts = [{ type: 'text-delta', text: 'Unsupported conclusions' }];
    await expect(
      research({ ...options(), readPublicPages: true }),
    ).rejects.toThrow('未执行网页搜索');
  });
  it('accepts competitor reports after a real search tool call', async () => {
    fixture.parts = [
      { type: 'tool-call', toolCallId: 's1', toolName: 'web_search' },
      { type: 'text-delta', text: 'Evidence-backed report' },
    ];
    const result = await research({ ...options(), readPublicPages: true });
    expect(result.text).toBe('Evidence-backed report');
  });
  it('disables search for report discussion and passes ordered conversation messages', async () => {
    fixture.parts = [
      { type: 'text-delta', text: 'Based on the pinned report.' },
    ];
    const history = [
      { role: 'user' as const, content: 'Pinned report' },
      { role: 'assistant' as const, content: 'Earlier private answer' },
    ];
    await research({ ...options(), goal: 'Follow-up', history, search: false });
    expect(fixture.agentOptions.tools).toEqual({});
    expect(fixture.streamOptions.messages).toEqual([
      ...history,
      { role: 'user', content: 'Follow-up' },
    ]);
    expect(fixture.streamOptions).not.toHaveProperty('prompt');
    expect(fixture.agentOptions.instructions).toContain('不具备网页搜索');
  });
});
