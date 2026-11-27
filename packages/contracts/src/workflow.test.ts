import { describe, expect, it } from 'vitest';
import { candidateInput, canTransitionTask, taskInput } from './workflow.js';
describe('collection workflow boundaries', () => {
  it('requires review before completion and supports deliberate retries', () => {
    expect(canTransitionTask('pending', 'completed')).toBe(false);
    expect(canTransitionTask('in_progress', 'completed')).toBe(false);
    expect(canTransitionTask('in_review', 'completed')).toBe(true);
    expect(canTransitionTask('completed', 'in_progress')).toBe(false);
    expect(canTransitionTask('failed', 'pending')).toBe(true);
  });
  it('requires an assignee and channel for actionable tasks', () => {
    expect(
      taskInput.safeParse({
        title: 'New topic',
        kind: 'content',
        channel: '',
        assigneeId: '',
        dueAt: null,
        priority: 'normal',
      }).success,
    ).toBe(false);
  });
  it('keeps unknown publication dates nullable and rejects non-web evidence', () => {
    const value = {
      title: 'A finding',
      summary: 'A supported summary',
      product: 'MagicTattoo',
      market: 'US',
      category: 'industry',
      claimType: 'analysis',
      publishedAt: null,
      language: null,
      tags: [],
      suggestedAction: '',
      sources: [
        { url: 'https://example.com', title: '', evidence: 'Evidence summary' },
      ],
    };
    expect(candidateInput.safeParse(value).success).toBe(true);
    const dated = candidateInput.parse({
      ...value,
      publishedAt: '2026-11-12',
      eventStartsAt: '2026-11-20',
      eventEndsAt: '2026-11-22',
    });
    expect(dated.publishedAt).toBe('2026-11-12');
    expect(dated.eventStartsAt).toBe('2026-11-20');
    expect(
      candidateInput.safeParse({ ...value, eventStartsAt: '2026-02-30' })
        .success,
    ).toBe(false);
    expect(candidateInput.safeParse({ ...value, sources: [] }).success).toBe(
      false,
    );
    expect(
      candidateInput.safeParse({
        ...value,
        sources: [{ ...value.sources[0], url: 'javascript:alert(1)' }],
      }).success,
    ).toBe(false);
  });
});
