import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  auth,
  growth,
  competitorResearch as c,
  researchConversations as r,
} from '@guangmo/database';
import {
  CONVERSATION_MAX_TURNS,
  CONVERSATION_REPORT_AND_QUESTION_LIMIT,
  type ConversationSource,
  type conversationCreate,
  type conversationMessage,
} from '@guangmo/contracts';
import type { z } from 'zod';
import { DatabaseService } from '../../platform/database.module.js';
import { ProductAccess } from '../products/product-access.service.js';
@Injectable()
export class ResearchConversationsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProductAccess) private readonly access: ProductAccess,
  ) {}
  async source(input: ConversationSource, write = false) {
    if (input.sourceKind === 'competitor') {
      const [row] = await this.database.db
        .select({
          product: c.competitorProfiles.product,
          title: c.competitorProfiles.name,
          report: c.competitorResearchRuns.report,
          status: c.competitorResearchRuns.status,
          completedAt: c.competitorResearchRuns.completedAt,
        })
        .from(c.competitorResearchRuns)
        .innerJoin(
          c.competitorProfiles,
          eq(c.competitorProfiles.id, c.competitorResearchRuns.competitorId),
        )
        .where(eq(c.competitorResearchRuns.id, input.sourceId));
      if (!row) throw new NotFoundException('来源报告不存在');
      await this.access.require(row.product, write);
      return row;
    }
    const [row] = await this.database.db
      .select()
      .from(growth.researchRuns)
      .where(eq(growth.researchRuns.id, input.sourceId));
    if (!row || !row.product)
      throw new NotFoundException('来源报告不存在或尚未归属产品');
    await this.access.require(row.product, write);
    return {
      product: row.product,
      title: row.goal,
      report: row.result,
      status: row.status,
      completedAt: row.completedAt,
    };
  }
  async list(input: ConversationSource, ownerId: string) {
    await this.source(input);
    return this.database.db
      .select({
        id: r.conversations.id,
        product: r.conversations.product,
        sourceKind: r.conversations.sourceKind,
        sourceId: r.conversations.sourceId,
        title: r.conversations.title,
        createdAt: r.conversations.createdAt,
      })
      .from(r.conversations)
      .where(
        and(
          eq(r.conversations.ownerId, ownerId),
          eq(r.conversations.sourceKind, input.sourceKind),
          eq(r.conversations.sourceId, input.sourceId),
        ),
      )
      .orderBy(desc(r.conversations.createdAt))
      .limit(100);
  }
  async create(input: z.infer<typeof conversationCreate>, ownerId: string) {
    const source = await this.source(input, true);
    if (source.status !== 'succeeded' || !source.report || !source.completedAt)
      throw new ConflictException('请等待报告完成后追问');
    const [row] = await this.database.db
      .insert(r.conversations)
      .values({
        ownerId,
        product: source.product,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        requestId: input.requestId,
        title: source.title.slice(0, 120),
        context: {
          sourceKind: input.sourceKind,
          sourceId: input.sourceId,
          title: source.title,
          report: source.report,
          collectedAt: source.completedAt.toISOString(),
        },
      })
      .onConflictDoNothing()
      .returning();
    const [existing] = row
      ? [row]
      : await this.database.db
          .select()
          .from(r.conversations)
          .where(
            and(
              eq(r.conversations.ownerId, ownerId),
              eq(r.conversations.requestId, input.requestId),
            ),
          );
    if (
      !existing ||
      existing.sourceId !== input.sourceId ||
      existing.sourceKind !== input.sourceKind
    )
      throw new ConflictException('请求标识已用于其他会话');
    return { id: existing.id };
  }
  async get(id: string, ownerId: string, write = false) {
    // No administrator override: private conversations are always owner-scoped.
    const [row] = await this.database.db
      .select()
      .from(r.conversations)
      .where(
        and(eq(r.conversations.id, id), eq(r.conversations.ownerId, ownerId)),
      );
    if (!row) throw new NotFoundException('会话不存在');
    await this.access.require(row.product, write);
    return row;
  }
  async detail(id: string, ownerId: string) {
    const row = await this.get(id, ownerId);
    const turns = await this.database.db
      .select()
      .from(r.conversationTurns)
      .where(eq(r.conversationTurns.conversationId, id))
      .orderBy(asc(r.conversationTurns.sequence));
    const events = turns.length
      ? await this.database.db
          .select()
          .from(r.conversationEvents)
          .where(
            inArray(
              r.conversationEvents.turnId,
              turns.map((t) => t.id),
            ),
          )
          .orderBy(
            asc(r.conversationEvents.createdAt),
            asc(r.conversationEvents.id),
          )
      : [];
    const shares = turns.length
      ? await this.database.db
          .select({
            turnId: r.sharedSupplements.turnId,
            id: r.sharedSupplements.id,
          })
          .from(r.sharedSupplements)
          .where(
            inArray(
              r.sharedSupplements.turnId,
              turns.map((t) => t.id),
            ),
          )
      : [];
    return {
      id: row.id,
      product: row.product,
      sourceKind: row.sourceKind,
      sourceId: row.sourceId,
      title: row.title,
      createdAt: row.createdAt,
      context: row.context,
      turns: turns.map(({ requestId: omit, ...turn }) => {
        void omit;
        return {
          ...turn,
          events: events.filter((e) => e.turnId === turn.id),
          sharedId: shares.find((s) => s.turnId === turn.id)?.id ?? null,
        };
      }),
    };
  }
  async send(
    id: string,
    input: z.infer<typeof conversationMessage>,
    ownerId: string,
  ) {
    await this.get(id, ownerId, true);
    return this.database.db.transaction(async (tx) => {
      const [conversation] = await tx
        .select()
        .from(r.conversations)
        .where(
          and(eq(r.conversations.id, id), eq(r.conversations.ownerId, ownerId)),
        )
        .for('update');
      if (!conversation) throw new NotFoundException('会话不存在');
      const turns = await tx
        .select({
          id: r.conversationTurns.id,
          requestId: r.conversationTurns.requestId,
          question: r.conversationTurns.question,
          mode: r.conversationTurns.mode,
          status: r.conversationTurns.status,
        })
        .from(r.conversationTurns)
        .where(eq(r.conversationTurns.conversationId, id))
        .orderBy(asc(r.conversationTurns.sequence));
      const existing = turns.find((t) => t.requestId === input.requestId);
      if (existing) {
        if (existing.question !== input.text || existing.mode !== input.mode)
          throw new ConflictException('请求标识已用于其他消息');
        return { id: existing.id };
      }
      if (turns.some((t) => t.status !== 'succeeded'))
        throw new ConflictException(
          '请等待当前回答完成；失败消息请先重试或新建会话',
        );
      if (turns.length >= CONVERSATION_MAX_TURNS)
        throw new ConflictException(
          `本会话已达${CONVERSATION_MAX_TURNS}轮，请新建会话`,
        );
      if (
        conversation.context.report.length + input.text.length >
        CONVERSATION_REPORT_AND_QUESTION_LIMIT
      )
        throw new ConflictException('报告与当前问题合计过长，请缩短问题');
      const [turn] = await tx
        .insert(r.conversationTurns)
        .values({
          conversationId: id,
          requestId: input.requestId,
          sequence: turns.length + 1,
          question: input.text,
          mode: input.mode,
        })
        .returning();
      return { id: turn!.id };
    });
  }
  async retry(id: string, turnId: string, ownerId: string) {
    await this.get(id, ownerId, true);
    return this.database.db.transaction(async (tx) => {
      await tx
        .select()
        .from(r.conversations)
        .where(eq(r.conversations.id, id))
        .for('update');
      const [turn] = await tx
        .select()
        .from(r.conversationTurns)
        .where(
          and(
            eq(r.conversationTurns.id, turnId),
            eq(r.conversationTurns.conversationId, id),
          ),
        )
        .for('update');
      if (!turn) throw new NotFoundException('消息不存在');
      if (turn.status !== 'failed')
        throw new ConflictException('只有失败消息可以重试');
      const [active] = await tx
        .select()
        .from(r.conversationTurns)
        .where(
          and(
            eq(r.conversationTurns.conversationId, id),
            inArray(r.conversationTurns.status, ['queued', 'running']),
          ),
        );
      if (active) throw new ConflictException('会话已有执行中的消息');
      await tx
        .update(r.conversationTurns)
        .set({
          status: 'queued',
          generation: turn.generation + 1,
          attempts: 0,
          error: null,
          answer: null,
          completedAt: null,
        })
        .where(eq(r.conversationTurns.id, turnId));
      return { id: turnId };
    });
  }
  async share(id: string, turnId: string, ownerId: string) {
    const conversation = await this.get(id, ownerId, true);
    return this.database.db.transaction(async (tx) => {
      const [turn] = await tx
        .select()
        .from(r.conversationTurns)
        .where(
          and(
            eq(r.conversationTurns.id, turnId),
            eq(r.conversationTurns.conversationId, id),
          ),
        )
        .for('update');
      if (!turn) throw new NotFoundException('消息不存在');
      if (turn.status !== 'succeeded' || !turn.answer)
        throw new ConflictException('只能分享完整回答');
      const events = await tx
        .select()
        .from(r.conversationEvents)
        .where(eq(r.conversationEvents.turnId, turnId));
      const sources = [
        ...new Map(
          events
            .filter((e) => e.data?.kind === 'source' && e.data.url)
            .map((e) => [
              e.data!.url!,
              { url: e.data!.url!, title: e.data?.title },
            ]),
        ).values(),
      ];
      const [row] = await tx
        .insert(r.sharedSupplements)
        .values({
          turnId,
          product: conversation.product,
          sourceKind: conversation.sourceKind,
          sourceId: conversation.sourceId,
          question: turn.question,
          answer: turn.answer,
          authorId: ownerId,
          sources,
        })
        .onConflictDoNothing()
        .returning();
      const [existing] = row
        ? [row]
        : await tx
            .select()
            .from(r.sharedSupplements)
            .where(eq(r.sharedSupplements.turnId, turnId));
      if (row)
        await tx.insert(growth.auditLog).values({
          actorId: ownerId,
          objectId: row.id,
          action: 'research.supplement.shared',
        });
      return { id: existing!.id };
    });
  }
  async shared(input: ConversationSource) {
    await this.source(input);
    // Deliberately exclude turnId/conversationId; sharing a result grants no thread access.
    return this.database.db
      .select({
        id: r.sharedSupplements.id,
        sourceKind: r.sharedSupplements.sourceKind,
        sourceId: r.sharedSupplements.sourceId,
        question: r.sharedSupplements.question,
        answer: r.sharedSupplements.answer,
        sources: r.sharedSupplements.sources,
        createdAt: r.sharedSupplements.createdAt,
        authorName: auth.user.name,
      })
      .from(r.sharedSupplements)
      .innerJoin(auth.user, eq(auth.user.id, r.sharedSupplements.authorId))
      .where(
        and(
          eq(r.sharedSupplements.sourceKind, input.sourceKind),
          eq(r.sharedSupplements.sourceId, input.sourceId),
        ),
      )
      .orderBy(desc(r.sharedSupplements.createdAt))
      .limit(100);
  }
}
