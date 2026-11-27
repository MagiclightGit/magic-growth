import { describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { compactFollowUpHistory, followUpHistory } from './follow-up.js';

vi.mock('ai', () => ({ generateText: vi.fn() }));
const context = {
  sourceKind: 'competitor' as const,
  sourceId: '00000000-0000-4000-8000-000000000000',
  title: 'Pinned report',
  collectedAt: '2026-11-17T09:00:00Z',
  report: 'Original report, not the latest version.',
};
describe('private follow-up model context', () => {
  it('pins the original report and its date, without inventing a current report', () => {
    const history = followUpHistory(context, []);
    expect(history).toHaveLength(1);
    expect(history[0]?.content).toContain(context.report);
    expect(history[0]?.content).toContain(context.collectedAt);
    expect(history[0]?.content).toContain('不能修改原报告');
  });
  it('preserves successful turn order and excludes failed partial answers', () => {
    const history = followUpHistory(context, [
      {
        question: 'First private question',
        answer: 'First answer',
        status: 'succeeded',
      },
      {
        question: 'Failed question',
        answer: 'Partial answer',
        status: 'failed',
      },
      { question: 'Follow-up', answer: 'Second answer', status: 'succeeded' },
    ]);
    expect(history.slice(1)).toEqual([
      { role: 'user', content: 'First private question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Follow-up' },
      { role: 'assistant', content: 'Second answer' },
    ]);
    expect(JSON.stringify(history)).not.toContain('Partial answer');
  });
});

describe('private follow-up rolling summary', () => {
  const model = { apiKey: 'fixture', model: 'fixture' };
  const turns = Array.from({ length: 12 }, (_, index) => ({
    sequence: index + 1,
    question: `Question ${index + 1}`,
    answer: `Answer ${index + 1}`,
    status: 'succeeded',
  }));

  it('skips model summarization for a short thread', async () => {
    vi.mocked(generateText).mockClear();
    const recent = turns.slice(0, 7);
    expect(await compactFollowUpHistory(model, null, recent)).toEqual({
      memory: null,
      recent,
    });
    expect(generateText).not.toHaveBeenCalled();
  });

  it('updates the cursor using only new successful history and keeps recent originals', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: 'Updated private summary',
    } as Awaited<ReturnType<typeof generateText>>);
    const previous = { text: 'Previous private summary', throughSequence: 4 };
    const { memory, recent } = await compactFollowUpHistory(model, previous, [
      ...turns,
      { sequence: 13, question: 'Failed', answer: 'Draft', status: 'failed' },
    ]);
    const prompt = vi.mocked(generateText).mock.lastCall?.[0].prompt;
    expect(JSON.parse(String(prompt))).toEqual({
      previousSummary: previous.text,
      turns: turns.slice(4, 8).map(({ sequence, question, answer }) => ({
        sequence,
        question,
        answer,
      })),
    });
    expect(memory).toEqual({
      text: 'Updated private summary',
      throughSequence: 8,
    });
    expect(recent).toEqual(turns.slice(-4));
    const history = followUpHistory(context, recent, memory);
    expect(history[0]?.content).toContain(memory?.text);
    expect(history[1]?.content).toBe('Question 9');
    expect(history).toHaveLength(9);
  });

  it('rejects a blank summary without advancing the cursor', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: ' ',
    } as Awaited<ReturnType<typeof generateText>>);
    await expect(compactFollowUpHistory(model, null, turns)).rejects.toThrow(
      '会话摘要为空或超出长度限制',
    );
  });
});
