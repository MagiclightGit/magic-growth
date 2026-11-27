import { and, asc, eq, gt, lt, ne } from 'drizzle-orm';
import {
  auth,
  canAccessProduct,
  researchConversations as r,
  type Database,
} from '@guangmo/database';
import {
  compactFollowUpHistory,
  followUpHistory,
  research,
} from '@guangmo/agent';
import type { ResearchEventData } from '@guangmo/contracts';
import type { ModelConfig } from './research.js';
export async function executeConversation(
  db: Database,
  id: string,
  generation: number,
  attempt: number,
  model: ModelConfig,
) {
  const [turn] = await db
    .select()
    .from(r.conversationTurns)
    .where(eq(r.conversationTurns.id, id));
  if (!turn || turn.generation !== generation || turn.status === 'succeeded')
    return;
  const [conversation] = await db
    .select()
    .from(r.conversations)
    .where(eq(r.conversations.id, turn.conversationId));
  if (!conversation) throw new Error('会话不存在');
  const { ownerId, product, context, memory: previousMemory } = conversation;
  async function authorize() {
    const [owner] = await db
      .select()
      .from(auth.user)
      .where(eq(auth.user.id, ownerId));
    if (
      !owner ||
      owner.disabled ||
      !['admin', 'operator'].includes(owner.role) ||
      !(await canAccessProduct(db, owner.id, product, true))
    )
      throw new Error('会话发起人失权或产品已归档');
  }
  await authorize();
  if (!model.apiKey || !model.model) throw new Error('模型尚未配置');
  const generationFilter = and(
    eq(r.conversationTurns.id, id),
    eq(r.conversationTurns.generation, generation),
  );
  const claimed = await db
    .update(r.conversationTurns)
    .set({
      status: 'running',
      attempts: attempt,
      answer: null,
      error: null,
      model: model.model,
      completedAt: null,
    })
    .where(and(generationFilter, ne(r.conversationTurns.status, 'succeeded')))
    .returning({ id: r.conversationTurns.id });
  if (!claimed.length) return;
  const current = and(
    generationFilter,
    eq(r.conversationTurns.status, 'running'),
    eq(r.conversationTurns.attempts, attempt),
  );
  const event = async (message: string, data?: ResearchEventData) => {
    await db.insert(r.conversationEvents).values({ turnId: id, message, data });
  };
  await event(turn.mode === 'research' ? '开始补充研究' : '开始解读报告');
  const history = await db
    .select({
      sequence: r.conversationTurns.sequence,
      question: r.conversationTurns.question,
      answer: r.conversationTurns.answer,
      status: r.conversationTurns.status,
    })
    .from(r.conversationTurns)
    .where(
      and(
        eq(r.conversationTurns.conversationId, turn.conversationId),
        gt(r.conversationTurns.sequence, previousMemory?.throughSequence ?? 0),
        eq(r.conversationTurns.status, 'succeeded'),
        lt(r.conversationTurns.sequence, turn.sequence),
      ),
    )
    .orderBy(asc(r.conversationTurns.sequence));
  const { memory, recent } = await compactFollowUpHistory(
    { apiKey: model.apiKey, baseURL: model.baseURL, model: model.model },
    previousMemory,
    history,
  );
  const result = await research({
    goal: turn.question,
    history: followUpHistory(context, recent, memory),
    search: turn.mode === 'research',
    readPublicPages: turn.mode === 'research',
    apiKey: model.apiKey,
    baseURL: model.baseURL,
    model: model.model,
    onProgress: event,
    onDraft: async (answer) => {
      await db.update(r.conversationTurns).set({ answer }).where(current);
    },
  });
  await authorize();
  await db.transaction(async (tx) => {
    const memoryChanged = memory !== previousMemory;
    if (memoryChanged)
      await tx
        .select({ id: r.conversations.id })
        .from(r.conversations)
        .where(eq(r.conversations.id, turn.conversationId))
        .for('update');
    const saved = await tx
      .update(r.conversationTurns)
      .set({
        status: 'succeeded',
        answer: result.text,
        error: null,
        completedAt: new Date(),
      })
      .where(current)
      .returning({ id: r.conversationTurns.id });
    if (!saved.length) return;
    if (memoryChanged)
      await tx
        .update(r.conversations)
        .set({ memory })
        .where(eq(r.conversations.id, turn.conversationId));
    await tx
      .insert(r.conversationEvents)
      .values({ turnId: id, message: '回答已保存，仅本人可见' });
  });
  // Private answers never enter shared researchRuns, extraction, scoring or team memory.
}
export async function failConversation(
  db: Database,
  id: string,
  generation: number,
  attempts: number,
  final: boolean,
  error: Error,
) {
  const saved = await db
    .update(r.conversationTurns)
    .set({
      status: final ? 'failed' : 'queued',
      attempts,
      error: error.message.slice(0, 1500),
      completedAt: final ? new Date() : null,
    })
    .where(
      and(
        eq(r.conversationTurns.id, id),
        eq(r.conversationTurns.generation, generation),
        ne(r.conversationTurns.status, 'succeeded'),
      ),
    )
    .returning();
  if (saved.length)
    await db.insert(r.conversationEvents).values({
      turnId: id,
      message: final ? '回答未完成，可重试' : '执行失败，准备重试',
    });
}
