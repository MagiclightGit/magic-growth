import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  competitorResearch as c,
  growth,
  requestCompetitorResearch,
} from '@guangmo/database';
import {
  canonicalizeUrl,
  watchKinds,
  type competitorProfileInput,
  type competitorProfileEdit,
  type CompetitorFinding,
} from '@guangmo/contracts';
import type { z } from 'zod';
import { DatabaseService } from '../../platform/database.module.js';
import { ProductAccess } from '../products/product-access.service.js';
function conflict(error: unknown): never {
  if (
    error &&
    typeof error === 'object' &&
    'cause' in error &&
    error.cause &&
    typeof error.cause === 'object' &&
    'code' in error.cause &&
    error.cause.code === '23505'
  )
    throw new ConflictException('此产品已有相同官网的竞品');
  throw error;
}
@Injectable()
export class CompetitorProfilesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProductAccess) private readonly access: ProductAccess,
  ) {}
  async get(id: string, write = false) {
    const [profile] = await this.database.db
      .select()
      .from(c.competitorProfiles)
      .where(eq(c.competitorProfiles.id, id));
    if (!profile) throw new NotFoundException('竞品不存在');
    await this.access.require(profile.product, write);
    return profile;
  }
  async list() {
    const rows = await this.database.db
      .select()
      .from(c.competitorProfiles)
      .where(this.access.condition(c.competitorProfiles.product))
      .orderBy(desc(c.competitorProfiles.createdAt))
      .limit(100);
    const latest = rows.length
      ? await this.database.db
          .selectDistinctOn([c.competitorResearchRuns.competitorId])
          .from(c.competitorResearchRuns)
          .where(
            inArray(
              c.competitorResearchRuns.competitorId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(
            c.competitorResearchRuns.competitorId,
            desc(c.competitorResearchRuns.createdAt),
          )
      : [];
    return rows.map((row) => ({
      ...row,
      latest: latest.find((r) => r.competitorId === row.id) ?? null,
    }));
  }
  async detail(id: string) {
    const profile = await this.get(id);
    const runs = await this.database.db
      .select()
      .from(c.competitorResearchRuns)
      .where(eq(c.competitorResearchRuns.competitorId, id))
      .orderBy(desc(c.competitorResearchRuns.createdAt))
      .limit(30);
    return { ...profile, runs, latest: runs[0] ?? null };
  }
  async create(input: z.infer<typeof competitorProfileInput>, actorId: string) {
    await this.access.require(input.product, true);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(c.competitorProfiles)
        .values({
          ...input,
          canonicalUrl: canonicalizeUrl(input.website),
          createdBy: actorId,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ConflictException('此产品已有相同官网的竞品');
      await tx
        .insert(growth.auditLog)
        .values({ actorId, objectId: row.id, action: 'competitor.created' });
      return row;
    });
  }
  async edit(
    id: string,
    input: z.infer<typeof competitorProfileEdit>,
    actorId: string,
  ) {
    const current = await this.get(id, true);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(c.competitorProfiles)
        .set({
          ...input.data,
          canonicalUrl: canonicalizeUrl(input.data.website),
          revision: input.revision + 1,
          ...(input.data.enabled && !current.enabled
            ? { nextRunAt: new Date() }
            : {}),
        })
        .where(
          and(
            eq(c.competitorProfiles.id, id),
            eq(c.competitorProfiles.revision, input.revision),
          ),
        )
        .returning()
        .catch(conflict);
      if (!row) throw new ConflictException('竞品配置已更新，请刷新后重试');
      await tx
        .insert(growth.auditLog)
        .values({ actorId, objectId: id, action: 'competitor.updated' });
      return row;
    });
  }
  async start(id: string, actorId: string) {
    await this.get(id, true);
    const run = await requestCompetitorResearch(this.database.db, id, actorId);
    if (!run) throw new ConflictException('当前成员无法执行此产品研究');
    await this.database.db.insert(growth.auditLog).values({
      actorId,
      objectId: run.id,
      action: 'competitor.research.requested',
      details: { competitorId: id },
    });
    return run;
  }
  async run(profileId: string, id: string) {
    await this.get(profileId);
    const [run] = await this.database.db
      .select()
      .from(c.competitorResearchRuns)
      .where(
        and(
          eq(c.competitorResearchRuns.id, id),
          eq(c.competitorResearchRuns.competitorId, profileId),
        ),
      );
    if (!run) throw new NotFoundException('研究批次不存在');
    const events = await this.database.db
      .select()
      .from(c.competitorResearchEvents)
      .where(eq(c.competitorResearchEvents.runId, id))
      .orderBy(
        asc(c.competitorResearchEvents.createdAt),
        asc(c.competitorResearchEvents.id),
      );
    const [previous] = run.previousRunId
      ? await this.database.db
          .select()
          .from(c.competitorResearchRuns)
          .where(
            and(
              eq(c.competitorResearchRuns.id, run.previousRunId),
              eq(c.competitorResearchRuns.competitorId, profileId),
            ),
          )
      : [];
    const publications = await this.database.db
      .select()
      .from(c.competitorResearchPublications)
      .where(eq(c.competitorResearchPublications.runId, id));
    return {
      ...run,
      events,
      previous: previous ?? null,
      published: Object.fromEntries(
        publications.map((p) => [p.dimension, p.intelligenceId]),
      ),
    };
  }
  async retry(profileId: string, id: string, actorId: string) {
    await this.get(profileId, true);
    return this.database.db.transaction(async (tx) => {
      await tx
        .select()
        .from(c.competitorProfiles)
        .where(eq(c.competitorProfiles.id, profileId))
        .for('update');
      const [run] = await tx
        .select()
        .from(c.competitorResearchRuns)
        .where(
          and(
            eq(c.competitorResearchRuns.id, id),
            eq(c.competitorResearchRuns.competitorId, profileId),
          ),
        )
        .for('update');
      if (!run) throw new NotFoundException('研究批次不存在');
      if (run.status !== 'failed')
        throw new ConflictException('只有失败批次可以重试');
      const [active] = await tx
        .select()
        .from(c.competitorResearchRuns)
        .where(
          and(
            eq(c.competitorResearchRuns.competitorId, profileId),
            inArray(c.competitorResearchRuns.status, ['queued', 'running']),
          ),
        );
      if (active) throw new ConflictException('此竞品已有正在执行的研究');
      const [updated] = await tx
        .update(c.competitorResearchRuns)
        .set({
          status: 'queued',
          generation: run.generation + 1,
          createdBy: actorId,
          attempts: 0,
          error: null,
          completedAt: null,
        })
        .where(eq(c.competitorResearchRuns.id, id))
        .returning();
      await tx
        .insert(growth.auditLog)
        .values({ actorId, objectId: id, action: 'competitor.research.retry' });
      return updated;
    });
  }
  async publish(
    profileId: string,
    id: string,
    dimension: CompetitorFinding['dimension'],
    actorId: string,
  ) {
    const profile = await this.get(profileId, true);
    return this.database.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(c.competitorResearchRuns)
        .where(
          and(
            eq(c.competitorResearchRuns.id, id),
            eq(c.competitorResearchRuns.competitorId, profileId),
          ),
        )
        .for('update');
      if (!run) throw new NotFoundException('研究批次不存在');
      const [existing] = await tx
        .select()
        .from(c.competitorResearchPublications)
        .where(
          and(
            eq(c.competitorResearchPublications.runId, id),
            eq(c.competitorResearchPublications.dimension, dimension),
          ),
        );
      if (existing) return { id: existing.intelligenceId };
      const finding = run.findings?.find((f) => f.dimension === dimension);
      if (
        run.status !== 'succeeded' ||
        !finding ||
        finding.availability !== 'found' ||
        !finding.evidence.length
      )
        throw new ConflictException('取得有依据的完整研究结果后才可确认入库');
      const primary = finding.evidence[0]!;
      const unique = new URL(primary.url);
      unique.searchParams.set('guangmo_competitor', `${id}-${dimension}`);
      const [item] = await tx
        .insert(growth.intelligence)
        .values({
          product: profile.product,
          market: run.config.market,
          title: `${run.config.name} · ${watchKinds[dimension]}`,
          category: 'competitor',
          summary: `${finding.summary}\n\n变化对比（分析判断）：${finding.comparison}\n研究采集时间：${run.completedAt?.toISOString()}。来源发布时间未能确认时为未知。`,
          sourceUrl: primary.url,
          canonicalUrl: canonicalizeUrl(unique.href),
          status: 'verified',
          createdBy: actorId,
          metadata: {
            claimType: finding.claimType,
            publishedAt: null,
            language: null,
            tags: ['竞品研究', watchKinds[dimension]],
            suggestedAction: '根据研究依据核实后创建任务。',
          },
        })
        .returning();
      const evidence = [
        ...new Map(
          finding.evidence.map((e) => [canonicalizeUrl(e.url), e]),
        ).values(),
      ];
      await tx.insert(growth.intelligenceEvidence).values(
        evidence.map((e) => ({
          intelligenceId: item!.id,
          url: e.url,
          canonicalUrl: canonicalizeUrl(e.url),
          title: e.title,
          evidence: `研究依据摘要（非原文引述）：${e.basis}`.slice(0, 2000),
        })),
      );
      await tx
        .insert(c.competitorResearchPublications)
        .values({ runId: id, dimension, intelligenceId: item!.id });
      await tx.insert(growth.auditLog).values({
        actorId,
        objectId: item!.id,
        action: 'competitor.finding.confirmed',
        details: { competitorId: profileId, runId: id, dimension },
      });
      return { id: item!.id };
    });
  }
}
