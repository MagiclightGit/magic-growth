import { ResearchQueue } from './research-queue.js';
import { ProductAccess } from '../products/product-access.service.js';
import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { growth } from '@guangmo/database';
import { type ResearchSchedule } from '@guangmo/contracts';
import { DatabaseService } from '../../platform/database.module.js';
import { env } from '../../config/env.js';
@Injectable()
export class ResearchService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProductAccess) private readonly access: ProductAccess,
    @Inject(ResearchQueue) private readonly runtime: ResearchQueue,
  ) {}
  integration() {
    return this.runtime.integration();
  }
  private requireAgent() {
    if (!env.OPENAI_API_KEY || !env.RESEARCH_MODEL)
      throw new ServiceUnavailableException(
        '研究服务尚未配置模型和搜索凭据，请联系管理员',
      );
  }
  list() {
    return this.database.db
      .select()
      .from(growth.researchRuns)
      .where(this.access.condition(growth.researchRuns.product))
      .orderBy(desc(growth.researchRuns.createdAt))
      .limit(50);
  }
  async detail(id: string) {
    await this.access.requireTarget('run', id);
    const [run] = await this.database.db
      .select()
      .from(growth.researchRuns)
      .where(eq(growth.researchRuns.id, id));
    if (!run) throw new NotFoundException('研究不存在');
    const events = await this.database.db
      .select()
      .from(growth.runEvents)
      .where(eq(growth.runEvents.runId, id))
      .orderBy(asc(growth.runEvents.createdAt));
    return { ...run, events };
  }
  async create(goal: string, actorId: string, product: string) {
    await this.access.require(product, true);
    this.requireAgent();
    const [run] = await this.database.db
      .insert(growth.researchRuns)
      .values({ goal, product, createdBy: actorId })
      .returning();
    if (!run) throw new ServiceUnavailableException('创建研究失败');
    // Queued rows are a durable outbox. Worker reconciles rows if queue delivery fails.
    try {
      await this.runtime.queue.add(
        'research',
        { runId: run.id },
        { jobId: run.id },
      );
    } catch {
      /* durable row remains queued */
    }
    return run;
  }
  schedules() {
    return this.database.db
      .select()
      .from(growth.researchSchedules)
      .where(this.access.condition(growth.researchSchedules.product))
      .orderBy(desc(growth.researchSchedules.createdAt));
  }
  async createSchedule(
    input: Pick<
      ResearchSchedule,
      'goal' | 'hour' | 'minute' | 'timezone' | 'product'
    >,
    actorId: string,
  ) {
    await this.access.require(input.product, true);
    this.requireAgent();
    const [item] = await this.database.db
      .insert(growth.researchSchedules)
      .values({ ...input, createdBy: actorId })
      .returning();
    return item;
  }
  async toggleSchedule(id: string, enabled: boolean, actorId: string) {
    await this.access.requireTarget('schedule', id, enabled);
    const [item] = await this.database.db
      .update(growth.researchSchedules)
      .set({ enabled })
      .where(
        and(
          eq(growth.researchSchedules.id, id),
          this.access.isAdmin
            ? undefined
            : eq(growth.researchSchedules.createdBy, actorId),
        ),
      )
      .returning();
    if (!item) throw new NotFoundException('计划不存在或不属于当前成员');
    return item;
  }
}
