import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { canonicalizeUrl, type FeedSourceInput } from '@guangmo/contracts';
import { collection, growth, requestCollectionRun } from '@guangmo/database';
import { DatabaseService } from '../../platform/database.module.js';
import { ProductAccess } from '../products/product-access.service.js';

const { feedSources, collectionRuns } = collection;

@Injectable()
export class SourcesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProductAccess) private readonly access: ProductAccess,
  ) {}

  async list() {
    const sources = await this.database.db
      .select()
      .from(feedSources)
      .where(this.access.condition(feedSources.product))
      .orderBy(feedSources.name, feedSources.id)
      .limit(100);
    if (!sources.length) return [];
    const runs = await this.database.db
      .selectDistinctOn([collectionRuns.sourceId])
      .from(collectionRuns)
      .where(
        inArray(
          collectionRuns.sourceId,
          sources.map((source) => source.id),
        ),
      )
      .orderBy(
        collectionRuns.sourceId,
        desc(collectionRuns.createdAt),
        desc(collectionRuns.id),
      );
    const latestBySource = new Map(runs.map((run) => [run.sourceId, run]));
    return sources.map((source) => ({
      ...source,
      latest: latestBySource.get(source.id) ?? null,
    }));
  }

  private async source(id: string, write = false) {
    const [source] = await this.database.db
      .select()
      .from(feedSources)
      .where(eq(feedSources.id, id));
    if (!source) throw new NotFoundException('来源不存在');
    await this.access.require(source.product, write);
    return source;
  }

  async history(id: string) {
    const source = await this.source(id);
    return this.database.db
      .select()
      .from(collectionRuns)
      .where(eq(collectionRuns.sourceId, source.id))
      .orderBy(desc(collectionRuns.createdAt), desc(collectionRuns.id))
      .limit(20);
  }

  async create(input: FeedSourceInput, actorId: string) {
    await this.access.require(input.product, true);
    return this.database.db.transaction(async (tx) => {
      const [source] = await tx
        .insert(feedSources)
        .values({
          ...input,
          canonicalUrl: canonicalizeUrl(input.url),
          createdBy: actorId,
        })
        .onConflictDoNothing()
        .returning();
      if (!source) throw new ConflictException('该产品下已登记此来源');
      await tx.insert(growth.auditLog).values({
        actorId: actorId,
        objectId: source.id,
        action: 'source.created',
      });
      return source;
    });
  }

  async toggle(
    id: string,
    { enabled, revision }: { enabled: boolean; revision: number },
    actorId: string,
  ) {
    const source = await this.source(id, true);
    return this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(feedSources)
        .set({
          enabled,
          revision: revision + 1,
          ...(enabled ? { nextRunAt: new Date() } : {}),
          createdBy: actorId,
        })
        .where(
          and(
            eq(feedSources.id, source.id),
            eq(feedSources.revision, revision),
          ),
        )
        .returning();
      if (!updated) throw new ConflictException('来源已更新，请刷新后重试');
      await tx.insert(growth.auditLog).values({
        actorId: actorId,
        objectId: source.id,
        action: enabled ? 'source.enabled' : 'source.paused',
      });
      return updated;
    });
  }

  async collect(id: string, actorId: string) {
    const source = await this.source(id, true);
    const run = await requestCollectionRun(
      this.database.db,
      source.id,
      actorId,
    );
    if (!run) throw new ConflictException('当前成员无法执行采集');
    return run;
  }
}
