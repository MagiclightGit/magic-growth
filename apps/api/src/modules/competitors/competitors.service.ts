import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  marketWatch as m,
  growth,
  requestWatchSnapshot,
  recordManualWatchSnapshot,
} from '@guangmo/database';
import {
  canonicalizeUrl,
  watchKinds,
  type watchInput,
  type watchConfigInput,
  type manualSnapshot,
  type CandidateStatus,
} from '@guangmo/contracts';
import type { z } from 'zod';
import { DatabaseService } from '../../platform/database.module.js';
import { ProductAccess } from '../products/product-access.service.js';
@Injectable()
export class CompetitorsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProductAccess) private readonly access: ProductAccess,
  ) {}
  async get(id: string, write = false) {
    const [watch] = await this.database.db
      .select()
      .from(m.competitorWatches)
      .where(eq(m.competitorWatches.id, id));
    if (!watch) throw new NotFoundException('监控不存在');
    await this.access.require(watch.product, write);
    return watch;
  }
  async list() {
    const watches = await this.database.db
      .select()
      .from(m.competitorWatches)
      .where(this.access.condition(m.competitorWatches.product))
      .orderBy(desc(m.competitorWatches.createdAt))
      .limit(100);
    const snapshots = watches.length
      ? await this.database.db
          .selectDistinctOn([m.competitorSnapshots.watchId])
          .from(m.competitorSnapshots)
          .where(
            inArray(
              m.competitorSnapshots.watchId,
              watches.map((w) => w.id),
            ),
          )
          .orderBy(
            m.competitorSnapshots.watchId,
            desc(m.competitorSnapshots.createdAt),
          )
      : [];
    return watches.map((w) => ({
      ...w,
      latest: snapshots.find((s) => s.watchId === w.id) ?? null,
    }));
  }
  async detail(id: string) {
    const watch = await this.get(id);
    const snapshots = await this.database.db
      .select()
      .from(m.competitorSnapshots)
      .where(eq(m.competitorSnapshots.watchId, id))
      .orderBy(desc(m.competitorSnapshots.createdAt))
      .limit(30);
    const candidates = snapshots.length
      ? await this.database.db
          .select({
            id: growth.intelligenceCandidates.id,
            origin: growth.intelligenceCandidates.originKey,
            status: growth.intelligenceCandidates.status,
            intelligenceId: growth.intelligenceCandidates.intelligenceId,
          })
          .from(growth.intelligenceCandidates)
          .where(
            inArray(
              growth.intelligenceCandidates.originKey,
              snapshots.map((snapshot) => `watch:${snapshot.id}`),
            ),
          )
      : [];
    const byOrigin = new Map(
      candidates.map((candidate) => [candidate.origin, candidate]),
    );
    const enriched = snapshots.map((snapshot) => {
      const candidate = byOrigin.get(`watch:${snapshot.id}`);
      return {
        ...snapshot,
        candidateId: candidate?.id ?? null,
        candidateStatus:
          (candidate?.status as CandidateStatus | undefined) ?? null,
        intelligenceId: candidate?.intelligenceId ?? snapshot.intelligenceId,
      };
    });
    return { ...watch, latest: enriched[0] ?? null, snapshots: enriched };
  }
  async create(input: z.infer<typeof watchInput>, actorId: string) {
    await this.access.require(input.product, true);
    const [watch] = await this.database.db
      .insert(m.competitorWatches)
      .values({
        ...input,
        canonicalUrl: canonicalizeUrl(input.url),
        createdBy: actorId,
      })
      .onConflictDoNothing()
      .returning();
    if (!watch) throw new ConflictException('此产品下已有相同页面和类型的监控');
    await this.database.db
      .insert(growth.auditLog)
      .values({ actorId, objectId: watch.id, action: 'watch.created' });
    return watch;
  }
  async toggle(
    id: string,
    enabled: boolean,
    revision: number,
    actorId: string,
  ) {
    await this.get(id, true);
    const [row] = await this.database.db
      .update(m.competitorWatches)
      .set({ enabled, revision: revision + 1, nextRunAt: new Date() })
      .where(
        and(
          eq(m.competitorWatches.id, id),
          eq(m.competitorWatches.revision, revision),
        ),
      )
      .returning();
    if (!row) throw new ConflictException('监控已更新，请刷新重试');
    await this.database.db.insert(growth.auditLog).values({
      actorId,
      objectId: id,
      action: 'watch.toggle',
      details: { enabled },
    });
    return row;
  }
  async configure(
    id: string,
    input: z.infer<typeof watchConfigInput>,
    actorId: string,
  ) {
    await this.get(id, true);
    return this.database.db.transaction(async (tx) => {
      const { revision, ...data } = input;
      const [row] = await tx
        .update(m.competitorWatches)
        .set({
          ...data,
          canonicalUrl: canonicalizeUrl(data.url),
          revision: revision + 1,
          nextRunAt: new Date(),
        })
        .where(
          and(
            eq(m.competitorWatches.id, id),
            eq(m.competitorWatches.revision, revision),
          ),
        )
        .returning()
        .catch((error: unknown) => {
          if (
            error &&
            typeof error === 'object' &&
            'cause' in error &&
            error.cause &&
            typeof error.cause === 'object' &&
            'code' in error.cause &&
            error.cause.code === '23505'
          )
            throw new ConflictException('此产品下已有相同页面和类型的监控');
          throw error;
        });
      if (!row) throw new ConflictException('监控已更新，请刷新重试');
      await tx
        .insert(growth.auditLog)
        .values({ actorId, objectId: id, action: 'watch.configured' });
      return row;
    });
  }
  async collect(id: string, actorId: string) {
    await this.get(id, true);
    return requestWatchSnapshot(this.database.db, id, actorId);
  }
  async manual(
    id: string,
    input: z.infer<typeof manualSnapshot>,
    actorId: string,
  ) {
    const watch = await this.get(id, true);
    if (input.price && watch.kind !== 'pricing')
      throw new ConflictException('仅定价页面支持结构化报价');
    return recordManualWatchSnapshot(this.database.db, id, actorId, input);
  }

  async publish(id: string, snapshotId: string, actorId: string) {
    const watch = await this.get(id, true);
    return this.database.db.transaction(async (tx) => {
      const [snapshot] = await tx
        .select()
        .from(m.competitorSnapshots)
        .where(
          and(
            eq(m.competitorSnapshots.id, snapshotId),
            eq(m.competitorSnapshots.watchId, id),
          ),
        )
        .for('update');
      if (!snapshot) throw new NotFoundException('快照不存在');
      if (snapshot.intelligenceId) return { id: snapshot.intelligenceId };
      if (snapshot.method === 'web' || snapshot.price) {
        const [candidate] = await tx
          .select({
            intelligenceId: growth.intelligenceCandidates.intelligenceId,
          })
          .from(growth.intelligenceCandidates)
          .where(
            eq(growth.intelligenceCandidates.originKey, `watch:${snapshot.id}`),
          );
        if (candidate?.intelligenceId) return { id: candidate.intelligenceId };
        throw new ConflictException(
          candidate ? '请从候选情报审核这条变化' : '此快照没有待核验的页面变化',
        );
      }
      if (snapshot.status !== 'succeeded' || !snapshot.content)
        throw new ConflictException('采集成功后才可确认入库');
      const sourceUrl = new URL(snapshot.sourceUrl);
      sourceUrl.searchParams.set('guangmo_snapshot', snapshot.id);
      const [item] = await tx
        .insert(growth.intelligence)
        .values({
          product: watch.product,
          market: watch.market,
          category: 'competitor',
          title: `${watch.name} · ${watchKinds[watch.kind as keyof typeof watchKinds]}`,
          summary: `${snapshot.change === 'baseline' ? '首次基线' : snapshot.change === 'changed' ? '检测到页面文本变化' : snapshot.change === 'unchanged' ? '本次未见文本变化' : '变化未知'}\n${snapshot.content.slice(0, 10000)}\n${snapshot.note}`,
          sourceUrl: snapshot.sourceUrl,
          canonicalUrl: canonicalizeUrl(sourceUrl.href),
          status: 'verified',
          metadata: {
            claimType: snapshot.claimType as 'fact' | 'estimate' | 'analysis',
            publishedAt: null,
            language: null,
            tags: ['竞品监控'],
            suggestedAction: '根据快照和原始页面核实变化后创建任务。',
          },
          createdBy: actorId,
        })
        .returning();
      await tx.insert(growth.intelligenceEvidence).values({
        intelligenceId: item!.id,
        url: snapshot.sourceUrl,
        canonicalUrl: canonicalizeUrl(snapshot.sourceUrl),
        title: watch.name,
        evidence: `采集时间：${snapshot.completedAt?.toISOString()}。${snapshot.method === 'web' ? '公开页面文本快照' : '人工记录'}；${snapshot.content.slice(0, 1500)}`,
      });
      await tx
        .update(m.competitorSnapshots)
        .set({ intelligenceId: item!.id })
        .where(eq(m.competitorSnapshots.id, snapshot.id));
      await tx.insert(growth.auditLog).values({
        actorId,
        objectId: item!.id,
        action: 'watch.confirmed',
        details: { watchId: id, snapshotId },
      });
      return { id: item!.id };
    });
  }
}
