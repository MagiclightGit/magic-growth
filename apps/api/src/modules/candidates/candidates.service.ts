import { ProductAccess } from '../products/product-access.service.js';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { growth, attachScores } from '@guangmo/database';
import {
  canonicalizeUrl,
  COLLECTION_WORKFLOW_VERSION,
  type CandidateInput,
  type CandidateReviewInput,
  type ManualCandidateInput,
  type CandidateStatus,
} from '@guangmo/contracts';
import { DatabaseService } from '../../platform/database.module.js';
const transport = (row: typeof growth.intelligenceCandidates.$inferSelect) => ({
  ...row.payload,
  id: row.id,
  runId: row.runId,
  extractionId: row.extractionId,
  collectionRunId: row.collectionRunId,
  origin: row.originKey?.startsWith('watch:')
    ? ('competitor' as const)
    : row.originKey?.startsWith('social:')
      ? ('social' as const)
      : undefined,
  status: row.status as CandidateStatus,
  intelligenceId: row.intelligenceId,
  revision: row.revision,
  reviewReason: row.reviewReason,
  reviewedAt: row.reviewedAt,
  createdAt: row.createdAt,
});
@Injectable()
export class CandidatesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProductAccess) private readonly access: ProductAccess,
  ) {}
  async list(status?: string, runId?: string, id?: string) {
    const rows = (
      await this.database.db
        .select()
        .from(growth.intelligenceCandidates)
        .where(
          and(
            this.access.condition(
              sql`${growth.intelligenceCandidates.payload}->>'product'`,
            ),
            id
              ? eq(growth.intelligenceCandidates.id, id)
              : status
                ? eq(growth.intelligenceCandidates.status, status)
                : undefined,
            runId ? eq(growth.intelligenceCandidates.runId, runId) : undefined,
          ),
        )
        .orderBy(desc(growth.intelligenceCandidates.createdAt))
        .limit(100)
    ).map(transport);
    return attachScores(
      this.database.db,
      'candidate',
      rows,
      rows.map((row) => ({
        ...row,
        eventStartsAt: row.eventStartsAt ?? null,
        eventEndsAt: row.eventEndsAt ?? null,
      })),
    );
  }
  async create(input: ManualCandidateInput, actorId: string) {
    await this.access.require(input.product, true);
    const { sourceUrl, evidence, ...fields } = input;
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(growth.intelligenceCandidates)
        .values({
          payload: {
            ...fields,
            sources: [{ url: sourceUrl, title: '', evidence }],
            language: null,
            tags: [],
          },
          manualSourceKey: canonicalizeUrl(sourceUrl),
          status: evidence ? 'pending' : 'needs_evidence',
        })
        .onConflictDoNothing()
        .returning();
      if (!row)
        throw new ConflictException(
          '该产品下已有相同链接的人工线索，请处理现有候选',
        );
      await tx.insert(growth.auditLog).values({
        actorId,
        objectId: row.id,
        action: 'candidate.created',
      });
      return transport(row);
    });
  }
  async batch(runId: string) {
    await this.access.requireTarget('run', runId);
    const [run] = await this.database.db
      .select({ id: growth.researchRuns.id })
      .from(growth.researchRuns)
      .where(eq(growth.researchRuns.id, runId));
    if (!run) throw new NotFoundException('研究不存在');
    const [extraction] = await this.database.db
      .select()
      .from(growth.researchExtractions)
      .where(eq(growth.researchExtractions.runId, runId));
    const rows = await this.database.db
      .select()
      .from(growth.intelligenceCandidates)
      .where(eq(growth.intelligenceCandidates.runId, runId))
      .orderBy(growth.intelligenceCandidates.position);
    const candidates = rows.map(transport);
    return {
      extraction: extraction ?? null,
      candidates: await attachScores(
        this.database.db,
        'candidate',
        candidates,
        candidates.map((row) => ({
          ...row,
          eventStartsAt: row.eventStartsAt ?? null,
          eventEndsAt: row.eventEndsAt ?? null,
        })),
      ),
    };
  }
  async requestExtraction(runId: string, actorId: string) {
    await this.access.requireTarget('run', runId, true);
    return this.database.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(growth.researchRuns)
        .where(eq(growth.researchRuns.id, runId))
        .for('update');
      if (!run) throw new NotFoundException('研究不存在');
      if (run.status !== 'succeeded' || !run.result)
        throw new ConflictException('请先完成研究');
      const [stage] = await tx
        .select()
        .from(growth.researchExtractions)
        .where(eq(growth.researchExtractions.runId, runId))
        .for('update');
      if (stage && stage.status !== 'failed') return stage;
      const [next] = stage
        ? await tx
            .update(growth.researchExtractions)
            .set({
              status: 'queued',
              generation: stage.generation + 1,
              attempts: 0,
              error: null,
              completedAt: null,
              createdBy: actorId,
            })
            .where(eq(growth.researchExtractions.id, stage.id))
            .returning()
        : await tx
            .insert(growth.researchExtractions)
            .values({
              runId,
              createdBy: actorId,
              workflowVersion: COLLECTION_WORKFLOW_VERSION,
            })
            .returning();
      await tx.insert(growth.auditLog).values({
        actorId,
        objectId: next!.id,
        action: stage ? 'extraction.retry' : 'extraction.requested',
        details: { runId },
      });
      return next;
    });
  }
  async edit(
    id: string,
    revision: number,
    payload: CandidateInput,
    actorId: string,
  ) {
    await this.access.requireTarget('candidate', id, true);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(growth.intelligenceCandidates)
        .where(eq(growth.intelligenceCandidates.id, id))
        .for('update');
      if (!row) throw new NotFoundException('候选情报不存在');
      if (payload.product !== row.payload.product)
        throw new ConflictException(
          '候选产品归属不可变更，请在对应产品重新研究',
        );
      if (
        row.manualSourceKey &&
        canonicalizeUrl(payload.sources[0]!.url) !== row.manualSourceKey
      )
        throw new ConflictException('人工线索的原链接不可替换，可补充其他来源');
      if (!['pending', 'needs_evidence'].includes(row.status))
        throw new ConflictException('已审核的候选情报不能修改');
      if (row.revision !== revision)
        throw new ConflictException('记录已更新，请刷新后重试');
      const [updated] = await tx
        .update(growth.intelligenceCandidates)
        .set({ payload, status: 'pending', revision: revision + 1 })
        .where(eq(growth.intelligenceCandidates.id, id))
        .returning();
      await tx.insert(growth.auditLog).values({
        actorId,
        objectId: id,
        action: 'candidate.edited',
        details: { before: row.payload, after: payload },
      });
      return transport(updated!);
    });
  }
  async review(
    id: string,
    { revision, action, reason, targetId }: CandidateReviewInput,
    actorId: string,
  ) {
    await this.access.requireTarget('candidate', id, true);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(growth.intelligenceCandidates)
        .where(eq(growth.intelligenceCandidates.id, id))
        .for('update');
      if (!row) throw new NotFoundException('候选情报不存在');
      const target =
        action === 'approve' || action === 'merge'
          ? 'approved'
          : action === 'reject'
            ? 'rejected'
            : 'needs_evidence';
      if (row.status === target && target !== 'needs_evidence')
        return transport(row);
      if (
        !['pending', 'needs_evidence'].includes(row.status) ||
        row.revision !== revision
      )
        throw new ConflictException('记录已更新，请刷新后重试');
      let intelligenceId: string | null = null;
      if (targetId) {
        const [related] = await tx
          .select({ id: growth.intelligence.id })
          .from(growth.intelligence)
          .where(
            and(
              eq(growth.intelligence.id, targetId),
              eq(growth.intelligence.product, row.payload.product),
              eq(growth.intelligence.status, 'verified'),
            ),
          )
          .for('update');
        if (!related) throw new ConflictException('请选择同产品下已核实的情报');
        intelligenceId = related.id;
      }
      if (action === 'approve' || action === 'merge') {
        if (
          row.status !== 'pending' ||
          row.payload.sources.some((source) => !source.evidence.trim())
        )
          throw new ConflictException('请补全原始来源证据并保存，再通过审核');
        const {
          sources,
          claimType,
          vertical,
          publishedAt,
          eventStartsAt,
          eventEndsAt,
          sourceTimes,
          language,
          tags,
          suggestedAction,
          ...input
        } = row.payload;
        const primary = sources[0]!;
        const identity = new URL(canonicalizeUrl(primary.url));
        if (row.originKey)
          identity.searchParams.set('guangmo_event', row.originKey);
        const eventUrl = canonicalizeUrl(identity.href);
        const [existing] = intelligenceId
          ? [{ id: intelligenceId }]
          : await tx
              .select({ id: growth.intelligence.id })
              .from(growth.intelligence)
              .where(
                and(
                  eq(growth.intelligence.product, input.product),
                  eq(growth.intelligence.canonicalUrl, eventUrl),
                ),
              );
        const [created] = existing
          ? []
          : await tx
              .insert(growth.intelligence)
              .values({
                ...input,
                sourceUrl: primary.url,
                canonicalUrl: eventUrl,
                metadata: {
                  claimType,
                  vertical,
                  publishedAt,
                  eventStartsAt,
                  eventEndsAt,
                  sourceTimes,
                  language,
                  tags,
                  suggestedAction,
                },
                status: 'verified',
                createdBy: actorId,
              })
              .onConflictDoNothing()
              .returning();
        const [concurrent] =
          existing || created
            ? []
            : await tx
                .select({ id: growth.intelligence.id })
                .from(growth.intelligence)
                .where(
                  and(
                    eq(growth.intelligence.product, input.product),
                    eq(growth.intelligence.canonicalUrl, eventUrl),
                  ),
                );
        intelligenceId = existing?.id ?? created?.id ?? concurrent!.id;
        if (action === 'approve' && !created) {
          await tx
            .update(growth.intelligence)
            .set({ status: 'verified', updatedAt: new Date() })
            .where(
              and(
                eq(growth.intelligence.id, intelligenceId),
                eq(growth.intelligence.status, 'pending'),
              ),
            );
        }
        await tx
          .insert(growth.intelligenceEvidence)
          .values(
            sources.map((source) => ({
              ...source,
              intelligenceId: intelligenceId!,
              runId: row.runId,
              canonicalUrl: canonicalizeUrl(source.url),
            })),
          )
          .onConflictDoNothing();
      }
      const [updated] = await tx
        .update(growth.intelligenceCandidates)
        .set({
          status: target,
          intelligenceId,
          reviewedBy: actorId,
          reviewedAt: new Date(),
          reviewReason: reason ?? null,
          revision: revision + 1,
        })
        .where(eq(growth.intelligenceCandidates.id, id))
        .returning();
      await tx.insert(growth.auditLog).values({
        actorId,
        objectId: id,
        action: action === 'merge' ? 'candidate.merged' : `candidate.${target}`,
        details: { intelligenceId, runId: row.runId, reason: reason ?? null },
      });
      return transport(updated!);
    });
  }
}
