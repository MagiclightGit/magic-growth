import { ProductAccess } from '../products/product-access.service.js';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { auth, growth } from '@guangmo/database';
import {
  canTransitionTask,
  type TaskInput,
  type TaskStatus,
  type taskUpdateInput,
} from '@guangmo/contracts';
import type { z } from 'zod';
import { DatabaseService } from '../../platform/database.module.js';
@Injectable()
export class TasksService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProductAccess) private readonly access: ProductAccess,
  ) {}
  async detail(id: string) {
    await this.access.requireTarget('task', id);
    const [task] = await this.database.db
      .select()
      .from(growth.workflowTasks)
      .where(eq(growth.workflowTasks.id, id));
    if (!task) throw new NotFoundException('任务不存在');
    return task;
  }
  list() {
    return this.database.db
      .select()
      .from(growth.workflowTasks)
      .where(this.access.condition(growth.workflowTasks.product))
      .orderBy(desc(growth.workflowTasks.createdAt))
      .limit(100);
  }
  assignees() {
    return this.access.assignees();
  }

  async create(intelligenceId: string, input: TaskInput, actorId: string) {
    const product = await this.access.requireTarget(
      'intelligence',
      intelligenceId,
      true,
    );
    const { canAccessProduct } = await import('@guangmo/database');
    if (!(await canAccessProduct(this.database.db, input.assigneeId, product)))
      throw new ConflictException('该成员没有此产品权限');
    return this.database.db.transaction(async (tx) => {
      // Lock the intelligence row so status changes and task creation serialize.
      const [item] = await tx
        .select()
        .from(growth.intelligence)
        .where(eq(growth.intelligence.id, intelligenceId))
        .for('update');
      if (!item) throw new NotFoundException('情报不存在');
      if (item.status !== 'verified')
        throw new ConflictException('请先确认情报有效');
      const [owner] = await tx
        .select()
        .from(auth.user)
        .where(eq(auth.user.id, input.assigneeId))
        .for('share');
      if (
        !owner ||
        owner.disabled ||
        !['admin', 'operator'].includes(owner.role)
      )
        throw new ConflictException('请选择可执行任务的成员');
      const [created] = await tx
        .insert(growth.workflowTasks)
        .values({
          ...input,
          intelligenceId,
          product: item.product,
          market: item.market,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          createdBy: actorId,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) {
        const [existing] = await tx
          .select()
          .from(growth.workflowTasks)
          .where(
            and(
              eq(growth.workflowTasks.intelligenceId, intelligenceId),
              eq(growth.workflowTasks.kind, input.kind),
            ),
          );
        return existing;
      }
      await tx.insert(growth.auditLog).values({
        actorId,
        objectId: created.id,
        action: 'task.created',
        details: {
          intelligenceId,
          kind: input.kind,
          assigneeId: input.assigneeId,
        },
      });
      return created;
    });
  }
  async update(
    id: string,
    input: z.infer<typeof taskUpdateInput>,
    actorId: string,
  ) {
    const product = await this.access.requireTarget('task', id, true);
    return this.database.db.transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(growth.workflowTasks)
        .where(eq(growth.workflowTasks.id, id))
        .for('update');
      if (!task) throw new NotFoundException('任务不存在');
      if (task.revision !== input.revision)
        throw new ConflictException('任务已更新，请刷新后重试');
      const status = input.status ?? (task.status as TaskStatus);
      if (!canTransitionTask(task.status as TaskStatus, status))
        throw new ConflictException('不支持此状态变更');
      const result = input.result ?? task.result;
      if (['completed', 'failed'].includes(status) && !result?.trim())
        throw new ConflictException('请填写结果或失败原因');
      if (input.assigneeId) {
        const { canAccessProduct } = await import('@guangmo/database');
        if (!(await canAccessProduct(tx, input.assigneeId, product)))
          throw new ConflictException('该成员没有此产品权限');
        const [owner] = await tx
          .select()
          .from(auth.user)
          .where(eq(auth.user.id, input.assigneeId))
          .for('share');
        if (
          !owner ||
          owner.disabled ||
          !['admin', 'operator'].includes(owner.role)
        )
          throw new ConflictException('负责人不可用');
      }
      const { revision, ...changes } = input;
      const [updated] = await tx
        .update(growth.workflowTasks)
        .set({
          ...changes,
          dueAt:
            input.dueAt === undefined
              ? task.dueAt
              : input.dueAt
                ? new Date(input.dueAt)
                : null,
          status,
          result,
          revision: revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(growth.workflowTasks.id, id))
        .returning();
      await tx.insert(growth.auditLog).values({
        actorId,
        objectId: id,
        action: 'task.updated',
        details: {
          before: { status: task.status, assigneeId: task.assigneeId },
          changes,
        },
      });
      return updated;
    });
  }
}
