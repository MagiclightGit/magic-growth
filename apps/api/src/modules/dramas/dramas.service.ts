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
  auth,
  canAccessProduct,
} from '@guangmo/database';
import {
  canonicalizeUrl,
  candidateInput,
  dramaTrend,
  type dramaInput,
  type observationInput,
  type originalScriptInput,
} from '@guangmo/contracts';
import type { z } from 'zod';
import { DatabaseService } from '../../platform/database.module.js';
import { ProductAccess } from '../products/product-access.service.js';
@Injectable()
export class DramasService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProductAccess) private readonly access: ProductAccess,
  ) {}
  async get(id: string, write = false) {
    const [row] = await this.database.db
      .select()
      .from(m.dramas)
      .where(eq(m.dramas.id, id));
    if (!row) throw new NotFoundException('短剧不存在');
    await this.access.require(row.product, write);
    return row;
  }
  async list() {
    const rows = await this.database.db
      .select()
      .from(m.dramas)
      .where(this.access.condition(m.dramas.product))
      .orderBy(desc(m.dramas.createdAt))
      .limit(100);
    const observations = rows.length
      ? await this.database.db
          .select()
          .from(m.dramaObservations)
          .where(
            inArray(
              m.dramaObservations.dramaId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(desc(m.dramaObservations.createdAt))
      : [];
    return rows.map((row) => {
      const entries = observations
        .filter((o) => o.dramaId === row.id)
        .map((o) => ({ ...o.data, id: o.id, createdAt: o.createdAt }));
      return {
        ...row.data,
        id: row.id,
        revision: row.revision,
        intelligenceId: row.intelligenceId,
        createdAt: row.createdAt,
        observations: entries,
        trend: dramaTrend(entries),
      };
    });
  }
  async detail(id: string) {
    const item = await this.get(id);
    const observations = await this.database.db
      .select()
      .from(m.dramaObservations)
      .where(eq(m.dramaObservations.dramaId, id));
    const entries = observations.map((o) => ({
      ...o.data,
      id: o.id,
      createdAt: o.createdAt,
    }));
    return {
      ...item.data,
      id: item.id,
      revision: item.revision,
      intelligenceId: item.intelligenceId,
      createdAt: item.createdAt,
      observations: entries,
      trend: dramaTrend(entries),
    };
  }
  async create(input: z.infer<typeof dramaInput>, actorId: string) {
    await this.access.require(input.product, true);
    const [row] = await this.database.db
      .insert(m.dramas)
      .values({
        product: input.product,
        title: input.title,
        platform: input.platform,
        market: input.market,
        data: input,
        canonicalUrl: canonicalizeUrl(input.sourceUrl),
        createdBy: actorId,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictException('此产品已有同名且同来源的短剧参考');
    await this.database.db
      .insert(growth.auditLog)
      .values({ actorId, objectId: row.id, action: 'drama.created' });
    return this.detail(row.id);
  }
  async edit(
    id: string,
    data: Omit<z.infer<typeof dramaInput>, 'product'>,
    revision: number,
    actorId: string,
  ) {
    const existing = await this.get(id, true);
    const [row] = await this.database.db
      .update(m.dramas)
      .set({
        title: data.title,
        platform: data.platform,
        market: data.market,
        data: { ...data, product: existing.product },
        canonicalUrl: canonicalizeUrl(data.sourceUrl),
        revision: revision + 1,
      })
      .where(and(eq(m.dramas.id, id), eq(m.dramas.revision, revision)))
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
          throw new ConflictException('此产品已有同名且同来源的短剧参考');
        throw error;
      });
    if (!row) throw new ConflictException('记录已更新，请刷新后重试');
    await this.database.db
      .insert(growth.auditLog)
      .values({ actorId, objectId: id, action: 'drama.edited' });
    return this.detail(id);
  }
  async observe(
    id: string,
    data: z.infer<typeof observationInput>,
    actorId: string,
  ) {
    const { inserted } = await this.saveObservations(id, [data], actorId);
    if (!inserted.length)
      throw new ConflictException('此时间点和口径已有观测记录');
    return inserted[0]!;
  }

  async importObservations(
    id: string,
    data: z.infer<typeof observationInput>[],
    actorId: string,
  ) {
    const { inserted } = await this.saveObservations(id, data, actorId);
    return {
      added: inserted.length,
      duplicates: data.length - inserted.length,
    };
  }

  private async saveObservations(
    id: string,
    data: z.infer<typeof observationInput>[],
    actorId: string,
  ) {
    await this.get(id, true);
    if (
      data.some(
        (observation) =>
          Date.parse(observation.observedAt) > Date.now() + 60000,
      )
    )
      throw new ConflictException('观测时间不能在未来');
    const identity = (observation: z.infer<typeof observationInput>) =>
      JSON.stringify([
        canonicalizeUrl(observation.sourceUrl),
        observation.metric,
        observation.unit,
        observation.scope,
        observation.provider || '',
        Date.parse(observation.observedAt),
      ]);
    return this.database.db.transaction(async (tx) => {
      await tx.select().from(m.dramas).where(eq(m.dramas.id, id)).for('update');
      const rows = await tx
        .select()
        .from(m.dramaObservations)
        .where(eq(m.dramaObservations.dramaId, id));
      const keys = new Set(rows.map((row) => identity(row.data)));
      const additions = data.flatMap((observation) => {
        const key = identity(observation);
        if (keys.has(key)) return [];
        keys.add(key);
        return [
          {
            dramaId: id,
            createdBy: actorId,
            data: {
              ...observation,
              sourceUrl: canonicalizeUrl(observation.sourceUrl),
              provider: observation.provider || undefined,
            },
          },
        ];
      });
      if (!additions.length) return { inserted: [] };
      const inserted = await tx
        .insert(m.dramaObservations)
        .values(additions)
        .returning();
      await tx.insert(growth.auditLog).values({
        actorId,
        objectId: id,
        action: 'drama.observed',
        details: { observationIds: inserted.map((row) => row.id) },
      });
      return { inserted };
    });
  }
  async candidate(id: string, actorId: string) {
    await this.get(id, true);
    return this.database.db.transaction(async (tx) => {
      const [item] = await tx
        .select()
        .from(m.dramas)
        .where(eq(m.dramas.id, id))
        .for('update');
      if (!item) throw new NotFoundException('素材不存在');
      if (!(await canAccessProduct(tx, actorId, item.product, true)))
        throw new ConflictException('产品权限已变更');
      const row = item.data;
      const observations = await tx
        .select()
        .from(m.dramaObservations)
        .where(eq(m.dramaObservations.dramaId, id));
      const trend = dramaTrend(
        observations.map((observation) => observation.data),
      );
      const fact = observations
        .filter(
          (observation) =>
            observation.data.claimType === 'fact' && !observation.data.cached,
        )
        .sort(
          (first, second) =>
            Date.parse(second.data.observedAt) -
            Date.parse(first.data.observedAt),
        )[0];
      const originKey = `social:${id}:${fact?.id ?? 'lead'}`;
      const evidence = fact
        ? `${trend.detail}\n单点观测 ${fact.data.metric} ${fact.data.value} ${fact.data.unit}\n${fact.data.provider || '人工观测'} · ${fact.data.scope} · ${fact.data.observedAt}`
        : '';
      const payload = candidateInput.omit({ sources: true }).parse({
        title: row.title,
        summary: evidence || '等待补充可核验的社媒指标或发布方原文。',
        product: row.product,
        market: row.market,
        vertical: row.vertical,
        category: 'content',
        claimType: 'source_claim',
        publishedAt: row.publishedAt ?? null,
        language: null,
        tags: ['社媒热点'],
        suggestedAction: row.transfer?.slice(0, 2000) || '',
      });
      const [created] = await tx
        .insert(growth.intelligenceCandidates)
        .values({
          payload: {
            ...payload,
            sources: [
              {
                url: fact?.data.sourceUrl ?? row.sourceUrl,
                title: row.title,
                evidence,
              },
            ],
          },
          originKey,
          status: evidence ? 'pending' : 'needs_evidence',
        })
        .onConflictDoNothing()
        .returning();
      if (created)
        await tx.insert(growth.auditLog).values({
          actorId,
          objectId: created.id,
          action: 'creative.candidate',
          details: { creativeId: id },
        });
      const [existing] = created
        ? [created]
        : await tx
            .select()
            .from(growth.intelligenceCandidates)
            .where(eq(growth.intelligenceCandidates.originKey, originKey));
      return { id: existing!.id, status: existing!.status };
    });
  }
  async script(
    id: string,
    input: z.infer<typeof originalScriptInput>,
    actorId: string,
  ) {
    const drama = await this.get(id, true);
    if (
      !drama.data.narrative?.trim() ||
      !drama.data.hook?.trim() ||
      ((drama.data.creativeType ?? 'drama') === 'drama' &&
        !drama.data.conflict?.trim())
    )
      throw new ConflictException('请先补充开场钩子、冲突结构与叙事参考');
    if (
      !(await canAccessProduct(
        this.database.db,
        input.task.assigneeId,
        drama.product,
        true,
      ))
    )
      throw new ConflictException('负责人没有此产品权限');
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(m.dramas)
        .where(eq(m.dramas.id, id))
        .for('update');
      if (!row) throw new NotFoundException('短剧不存在');
      if (
        !row.data.narrative?.trim() ||
        !row.data.hook?.trim() ||
        ((row.data.creativeType ?? 'drama') === 'drama' &&
          !row.data.conflict?.trim())
      )
        throw new ConflictException('请先补充开场钩子、冲突结构与叙事参考');
      const [member] = await tx
        .select()
        .from(auth.user)
        .where(eq(auth.user.id, input.task.assigneeId))
        .for('share');
      if (
        !member ||
        member.disabled ||
        !['admin', 'operator'].includes(member.role)
      )
        throw new ConflictException('请选择可执行任务的成员');
      let intelligenceId = row.intelligenceId;
      if (!intelligenceId) {
        const url = new URL(row.data.sourceUrl);
        url.searchParams.set('guangmo_drama', id);
        const [item] = await tx
          .insert(growth.intelligence)
          .values({
            product: row.product,
            market: row.market,
            title: `叙事参考：${row.title}`,
            summary: `结构参考（分析判断）\n题材：${row.data.genre ?? '未知'}\n钩子：${row.data.hook}\n冲突：${row.data.conflict}\n反转：${row.data.reversal ?? '未知'}\n节奏：${row.data.pacing ?? '未知'}\n叙事结构：${row.data.narrative}\n来源：${row.data.sourceUrl}\n仅参考结构，不复制角色、台词、情节表达或素材；原创任务需要重新设计并审核。`,
            sourceUrl: row.data.sourceUrl,
            canonicalUrl: canonicalizeUrl(url.href),
            category: 'content',
            status: 'verified',
            createdBy: actorId,
            metadata: {
              claimType: 'analysis',
              publishedAt: row.data.publishedAt ?? null,
              language: null,
              tags: ['短剧', '叙事结构参考'],
              suggestedAction: input.brief,
            },
          })
          .returning();
        intelligenceId = item!.id;
        await tx.insert(growth.intelligenceEvidence).values({
          intelligenceId,
          url: row.data.sourceUrl,
          canonicalUrl: canonicalizeUrl(row.data.sourceUrl),
          title: row.title,
          evidence: row.data.narrative!.slice(0, 2000),
        });
        await tx
          .update(m.dramas)
          .set({ intelligenceId })
          .where(eq(m.dramas.id, id));
      }
      const [existing] = await tx
        .select()
        .from(growth.workflowTasks)
        .where(
          and(
            eq(growth.workflowTasks.intelligenceId, intelligenceId),
            eq(growth.workflowTasks.kind, 'content'),
          ),
        );
      if (existing) return existing;
      const [task] = await tx
        .insert(growth.workflowTasks)
        .values({
          ...input.task,
          intelligenceId,
          product: row.product,
          market: row.market,
          dueAt: input.task.dueAt ? new Date(input.task.dueAt) : null,
          createdBy: actorId,
          brief: `原创方向：${input.brief}\n参考来源：${row.data.sourceUrl}\n结构参考：${row.data.narrative}\n重新设计角色、场景、冲突与表达；禁止复制原剧台词、整段素材及具体表达。交付前进行原创性审核。`,
        })
        .returning();
      await tx.insert(growth.auditLog).values({
        actorId,
        objectId: task!.id,
        action: 'drama.script',
        details: { dramaId: id, intelligenceId },
      });
      return task!;
    });
  }
}
