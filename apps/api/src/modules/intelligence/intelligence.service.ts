import { ProductAccess } from '../products/product-access.service.js';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  desc,
  eq,
  ilike,
  or,
  sql,
  gte,
  inArray,
  isNull,
} from 'drizzle-orm';
import { auth, growth, attachIntelligenceScores } from '@guangmo/database';
import {
  canonicalizeUrl,
  collectionCutoff,
  type IntelligenceListFilters,
  type IntelligenceInput,
} from '@guangmo/contracts';
import { DatabaseService } from '../../platform/database.module.js';
@Injectable()
export class IntelligenceService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProductAccess) private readonly access: ProductAccess,
  ) {}
  async list(filters: IntelligenceListFilters) {
    const {
      search,
      status,
      category,
      product,
      market,
      range,
      owner,
      view,
      dateField,
      vertical,
    } = filters;
    const now = new Date();
    const cutoff = collectionCutoff(
      view === 'today' && range === 'all' ? '24h' : range,
      now,
    );
    const byPublication =
      (dateField ??
        (view && view !== 'history' ? 'published' : 'collected')) ===
      'published';
    const publication = sql`(${growth.intelligence.metadata}->>'publishedAt')`;
    const publicationTimestamp = sql`case when length(${publication}) = 10
      then ${publication}::date::timestamp at time zone 'Asia/Shanghai'
      else ${publication}::timestamptz end`;
    const date = byPublication
      ? publicationTimestamp
      : growth.intelligence.createdAt;
    const reading = view && view !== 'history';
    const viewCategory =
      view === 'competitor'
        ? 'competitor'
        : view === 'social'
          ? 'content'
          : null;
    const rows = await this.database.db
      .select({ item: growth.intelligence })
      .from(growth.intelligence)
      .leftJoin(auth.user, eq(growth.intelligence.ownerId, auth.user.id))
      .where(
        and(
          this.access.condition(growth.intelligence.product),
          search
            ? or(
                ilike(growth.intelligence.title, `%${search}%`),
                ilike(growth.intelligence.summary, `%${search}%`),
                ilike(auth.user.name, `%${search}%`),
              )
            : undefined,
          reading
            ? eq(growth.intelligence.status, 'verified')
            : status
              ? eq(growth.intelligence.status, status)
              : undefined,
          view === 'industry'
            ? inArray(growth.intelligence.category, ['industry', 'merchant'])
            : viewCategory
              ? eq(growth.intelligence.category, viewCategory)
              : undefined,
          vertical
            ? sql`${growth.intelligence.metadata}->>'vertical' = ${vertical}`
            : undefined,
          category ? eq(growth.intelligence.category, category) : undefined,
          product ? eq(growth.intelligence.product, product) : undefined,
          market ? eq(growth.intelligence.market, market) : undefined,
          cutoff
            ? byPublication
              ? sql`case when length(${publication}) = 10
                  then ${publication}::date >= (${cutoff.toISOString()}::timestamptz at time zone 'Asia/Shanghai')::date
                  else ${date} >= ${cutoff.toISOString()}::timestamptz end`
              : gte(growth.intelligence.createdAt, cutoff)
            : undefined,
          cutoff
            ? sql`${date} <= ${now.toISOString()}::timestamptz`
            : undefined,
          owner === 'unassigned'
            ? isNull(growth.intelligence.ownerId)
            : owner
              ? eq(growth.intelligence.ownerId, owner)
              : undefined,
        ),
      )
      .orderBy(
        ...(byPublication ? [sql`${date} desc nulls last`] : []),
        desc(growth.intelligence.createdAt),
        desc(growth.intelligence.id),
      )
      .limit(100);
    const scored = await attachIntelligenceScores(
      this.database.db,
      rows.map((r) => r.item),
    );
    return this.enrichRows(scored);
  }
  private async enrichRows<T extends typeof growth.intelligence.$inferSelect>(
    rows: T[],
  ) {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const ownerIds = [
      ...new Set(
        rows.map((row) => row.ownerId).filter((id): id is string => !!id),
      ),
    ];
    const [owners, tasks] = await Promise.all([
      ownerIds.length
        ? this.database.db
            .select({
              id: auth.user.id,
              name: auth.user.name,
              disabled: auth.user.disabled,
              role: auth.user.role,
            })
            .from(auth.user)
            .where(inArray(auth.user.id, ownerIds))
        : Promise.resolve([]),
      this.database.db
        .select({
          intelligenceId: growth.workflowTasks.intelligenceId,
          id: growth.workflowTasks.id,
          title: growth.workflowTasks.title,
          kind: growth.workflowTasks.kind,
          channel: growth.workflowTasks.channel,
          status: growth.workflowTasks.status,
          result: growth.workflowTasks.result,
          assigneeName: auth.user.name,
        })
        .from(growth.workflowTasks)
        .leftJoin(auth.user, eq(growth.workflowTasks.assigneeId, auth.user.id))
        .where(inArray(growth.workflowTasks.intelligenceId, ids))
        .orderBy(desc(growth.workflowTasks.updatedAt)),
    ]);
    return rows.map((row) => ({
      ...row,
      owner: owners.find((owner) => owner.id === row.ownerId) ?? null,
      taskSummary: tasks.filter((task) => task.intelligenceId === row.id),
    }));
  }
  assignees() {
    return this.access.assignees();
  }

  async assign(
    id: string,
    ownerId: string | null,
    revision: number,
    actorId: string,
  ) {
    const product = await this.access.requireTarget('intelligence', id, true);
    await this.database.db.transaction(async (tx) => {
      const [item] = await tx
        .select()
        .from(growth.intelligence)
        .where(eq(growth.intelligence.id, id))
        .for('update');
      if (!item) throw new NotFoundException('情报不存在');
      if (item.ownerRevision !== revision)
        throw new ConflictException('负责人已更新，请刷新后重试');
      if (ownerId) {
        const { canAccessProduct } = await import('@guangmo/database');
        if (!(await canAccessProduct(tx, ownerId, product)))
          throw new ConflictException('该成员没有此产品权限');
        const [owner] = await tx
          .select()
          .from(auth.user)
          .where(eq(auth.user.id, ownerId))
          .for('share');
        if (
          !owner ||
          owner.disabled ||
          !['admin', 'operator'].includes(owner.role)
        )
          throw new ConflictException('请选择可跟进情报的在职成员');
      }
      if (item.ownerId === ownerId) return;
      await tx
        .update(growth.intelligence)
        .set({ ownerId, ownerRevision: revision + 1, updatedAt: new Date() })
        .where(eq(growth.intelligence.id, id));
      await tx.insert(growth.auditLog).values({
        actorId,
        objectId: id,
        action: 'intelligence.owner',
        details: {
          before: item.ownerId,
          after: ownerId,
          revision: revision + 1,
        },
      });
    });
    return this.detail(id);
  }
  async detail(id: string) {
    await this.access.requireTarget('intelligence', id);
    const [item] = await this.database.db
      .select()
      .from(growth.intelligence)
      .where(eq(growth.intelligence.id, id));
    if (!item) throw new NotFoundException('情报不存在');
    const sources = await this.database.db
      .select()
      .from(growth.intelligenceEvidence)
      .where(eq(growth.intelligenceEvidence.intelligenceId, id));
    const tasks = await this.database.db
      .select()
      .from(growth.workflowTasks)
      .where(eq(growth.workflowTasks.intelligenceId, id));
    const [scored] = await attachIntelligenceScores(this.database.db, [item]);
    const [enriched] = await this.enrichRows([scored!]);
    return { ...enriched!, sources, tasks };
  }
  async create(input: IntelligenceInput, actorId: string) {
    await this.access.require(input.product, true);
    const rows = await this.database.db.transaction(async (tx) => {
      const [item] = await tx
        .insert(growth.intelligence)
        .values({
          ...input,
          canonicalUrl: canonicalizeUrl(input.sourceUrl),
          createdBy: actorId,
        })
        .onConflictDoNothing()
        .returning();
      if (!item)
        throw new ConflictException(
          '该产品下已有相同来源的情报，请查看现有记录',
        );
      await tx.insert(growth.intelligenceEvidence).values({
        intelligenceId: item.id,
        url: input.sourceUrl,
        canonicalUrl: canonicalizeUrl(input.sourceUrl),
        title: input.title,
        evidence: input.summary,
      });
      await tx
        .insert(growth.auditLog)
        .values({ actorId, action: 'intelligence.created', objectId: item.id });
      return item;
    });
    return rows;
  }
  async updateStatus(id: string, status: string, actorId: string) {
    await this.access.requireTarget('intelligence', id, true);
    return this.database.db.transaction(async (tx) => {
      const [item] = await tx
        .update(growth.intelligence)
        .set({ status, updatedAt: new Date() })
        .where(eq(growth.intelligence.id, id))
        .returning();
      if (!item) throw new NotFoundException('情报不存在');
      await tx.insert(growth.auditLog).values({
        actorId,
        action: 'intelligence.status',
        objectId: id,
        details: { status },
      });
      return item;
    });
  }
  async overview() {
    const [counts, runs, recentItems, recentRuns] = await Promise.all([
      this.database.db
        .select({
          total: sql<number>`count(*)::int`,
          pending: sql<number>`count(*) filter (where status = 'pending')::int`,
          verified: sql<number>`count(*) filter (where status = 'verified')::int`,
        })
        .from(growth.intelligence)
        .where(this.access.condition(growth.intelligence.product)),
      this.database.db
        .select({ count: sql<number>`count(*)::int` })
        .from(growth.researchRuns)
        .where(this.access.condition(growth.researchRuns.product)),
      this.database.db
        .select()
        .from(growth.intelligence)
        .where(this.access.condition(growth.intelligence.product))
        .orderBy(desc(growth.intelligence.createdAt))
        .limit(5),
      this.database.db
        .select()
        .from(growth.researchRuns)
        .where(this.access.condition(growth.researchRuns.product))
        .orderBy(desc(growth.researchRuns.createdAt))
        .limit(4),
    ]);
    return { ...counts[0], runs: runs[0]?.count ?? 0, recentItems, recentRuns };
  }
}
