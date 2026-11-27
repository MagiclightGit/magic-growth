import { z } from 'zod';
import {
  Body,
  ConflictException,
  Controller,
  Get,
  Global,
  Inject,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { catalog, growth, auth } from '@guangmo/database';
import {
  productInput,
  productUpdate,
  productGrants,
  productId,
} from '@guangmo/contracts';
import { Roles, type AuthRequest } from '../auth/auth.guard.js';
import { DatabaseService } from '../../platform/database.module.js';
import { parse } from '../../platform/validation.js';
import { ProductAccess } from './product-access.service.js';
@Controller()
class ProductsController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProductAccess) private readonly access: ProductAccess,
  ) {}
  @Get('products') list() {
    return this.database.db
      .select()
      .from(catalog.products)
      .where(this.access.condition(catalog.products.id, false))
      .orderBy(catalog.products.name);
  }
  @Post('products') @Roles('admin') async create(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const input = parse(productInput, body);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(catalog.products)
        .values(input)
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ConflictException('产品标识已存在');
      await tx.insert(growth.auditLog).values({
        actorId: req.member.id,
        objectId: row.id,
        action: 'product.created',
      });
      return row;
    });
  }
  @Patch('products/:id') @Roles('admin') async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const input = parse(productUpdate, body);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(catalog.products)
        .set(input)
        .where(eq(catalog.products.id, parse(productId, id)))
        .returning();
      if (!row) throw new NotFoundException('产品不存在');
      await tx.insert(growth.auditLog).values({
        actorId: req.member.id,
        objectId: id,
        action: 'product.updated',
        details: input,
      });
      return row;
    });
  }
  @Get('members/:id/products') @Roles('admin') async grants(
    @Param('id') id: string,
  ) {
    const [user] = await this.database.db
      .select()
      .from(auth.user)
      .where(eq(auth.user.id, id));
    if (!user) throw new NotFoundException('成员不存在');
    const rows = await this.database.db
      .select()
      .from(catalog.productMembers)
      .where(eq(catalog.productMembers.userId, id));
    return {
      productIds: rows.map((r) => r.productId),
      revision: user.productRevision,
    };
  }
  @Patch('members/:id/products') @Roles('admin') async grant(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const input = parse(productGrants, body);
    return this.database.db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(auth.user)
        .where(eq(auth.user.id, id))
        .for('update');
      if (!user) throw new NotFoundException('成员不存在');
      if (user.role === 'admin')
        throw new ConflictException('管理员可访问全部产品');
      if (user.productRevision !== input.revision)
        throw new ConflictException('授权已更新，请刷新后重试');
      const ids = [...new Set(input.productIds)];
      for (const product of ids) {
        const [row] = await tx
          .select()
          .from(catalog.products)
          .where(eq(catalog.products.id, product))
          .for('share');
        if (!row) throw new ConflictException('产品不存在');
      }
      await tx
        .delete(catalog.productMembers)
        .where(eq(catalog.productMembers.userId, id));
      if (ids.length)
        await tx
          .insert(catalog.productMembers)
          .values(ids.map((product) => ({ productId: product, userId: id })));
      await tx
        .update(auth.user)
        .set({ productRevision: input.revision + 1 })
        .where(
          and(
            eq(auth.user.id, id),
            eq(auth.user.productRevision, input.revision),
          ),
        );
      await tx.insert(growth.auditLog).values({
        actorId: req.member.id,
        objectId: id,
        action: 'member.products',
        details: { productIds: ids },
      });
      return { productIds: ids, revision: input.revision + 1 };
    });
  }
  @Patch('schedules/:id/product') @Roles('admin') async classifySchedule(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    id = parse(z.uuid(), id);
    const product = parse(z.object({ product: productId }), body).product;
    await this.access.require(product, true);
    return this.database.db.transaction(async (tx) => {
      const [plan] = await tx
        .select()
        .from(growth.researchSchedules)
        .where(eq(growth.researchSchedules.id, id))
        .for('update');
      if (!plan) throw new NotFoundException('计划不存在');
      if (plan.product !== null)
        throw new ConflictException('已有产品归属不可变更');
      const [row] = await tx
        .update(growth.researchSchedules)
        .set({ product, enabled: false })
        .where(eq(growth.researchSchedules.id, id))
        .returning();
      await tx.insert(growth.auditLog).values({
        actorId: req.member.id,
        objectId: id,
        action: 'schedule.product',
        details: { product },
      });
      return row;
    });
  }
  @Patch('research/:id/product') @Roles('admin') async classify(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    id = parse(z.uuid(), id);
    const product = parse(z.object({ product: productId }), body).product;
    await this.access.require(product, true);
    return this.database.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(growth.researchRuns)
        .where(eq(growth.researchRuns.id, id))
        .for('update');
      if (!run) throw new NotFoundException('研究不存在');
      const candidates = await tx
        .select()
        .from(growth.intelligenceCandidates)
        .where(eq(growth.intelligenceCandidates.runId, id));
      if (candidates.some((c) => c.payload.product !== product))
        throw new ConflictException(
          '候选包含其他产品，不能更改此报告的可见范围',
        );
      if (run.product !== null)
        throw new ConflictException('已有产品归属不可变更');
      const [row] = await tx
        .update(growth.researchRuns)
        .set({ product })
        .where(eq(growth.researchRuns.id, id))
        .returning();
      await tx.insert(growth.auditLog).values({
        actorId: req.member.id,
        objectId: id,
        action: 'research.product',
        details: { product },
      });
      return row;
    });
  }
}
@Global()
@Module({
  providers: [ProductAccess],
  exports: [ProductAccess],
  controllers: [ProductsController],
})
export class ProductsModule {}
