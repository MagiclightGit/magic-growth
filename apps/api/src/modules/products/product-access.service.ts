import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { and, eq, sql, type SQLWrapper } from 'drizzle-orm';
import { catalog, auth, growth } from '@guangmo/database';
import type { AuthRequest } from '../auth/auth.guard.js';
import { DatabaseService } from '../../platform/database.module.js';
import { productId } from '@guangmo/contracts';
import { parse } from '../../platform/validation.js';

// One authorization predicate shared by all domain services; membership is read live.
@Injectable({ scope: Scope.REQUEST })
export class ProductAccess {
  constructor(
    @Inject(REQUEST) private readonly request: AuthRequest,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  get isAdmin() {
    return this.request.member.role === 'admin';
  }
  condition(column: SQLWrapper, selected = true) {
    const id = this.request.member.id;
    const requested = this.request.query.product;
    const filter =
      selected && requested !== undefined
        ? parse(productId, requested)
        : undefined;
    return and(
      filter ? sql`${column} = ${filter}` : undefined,
      sql`(exists (select 1 from ${auth.user} u where u.id = ${id} and u.disabled = false and u.role = 'admin') or exists (select 1 from ${catalog.productMembers} pm join ${auth.user} u on u.id = pm.user_id where pm.user_id = ${id} and pm.product_id = ${column} and u.disabled = false))`,
    )!;
  }
  assignees() {
    return this.database.db
      .select({ id: auth.user.id, name: auth.user.name })
      .from(auth.user)
      .where(
        and(
          eq(auth.user.disabled, false),
          sql`${auth.user.role} in ('admin','operator')`,
          sql`exists (select 1 from ${catalog.products} where ${this.condition(catalog.products.id)} and (${auth.user.role} = 'admin' or exists (select 1 from ${catalog.productMembers} pm2 where pm2.product_id = ${catalog.products.id} and pm2.user_id = ${auth.user.id})))`,
        ),
      )
      .orderBy(auth.user.name, auth.user.id);
  }
  async require(product: string | null, writable = false) {
    if (product === null) {
      const [admin] = await this.database.db
        .select()
        .from(auth.user)
        .where(
          and(
            eq(auth.user.id, this.request.member.id),
            eq(auth.user.role, 'admin'),
            eq(auth.user.disabled, false),
          ),
        );
      if (!admin || writable)
        throw new ForbiddenException('请先由管理员关联产品');
      return;
    }
    const [row] = await this.database.db
      .select()
      .from(catalog.products)
      .where(
        and(
          eq(catalog.products.id, product),
          this.condition(catalog.products.id, false),
        ),
      );
    if (!row) throw new ForbiddenException('无此产品访问权限');
    if (writable && row.archived)
      throw new ForbiddenException('产品已归档，请先恢复产品');
  }
  async requireTarget(
    kind: 'candidate' | 'intelligence' | 'task' | 'run' | 'schedule',
    id: string,
    writable = false,
  ) {
    let product: string | null | undefined;
    if (kind === 'candidate') {
      const [row] = await this.database.db
        .select()
        .from(growth.intelligenceCandidates)
        .where(eq(growth.intelligenceCandidates.id, id));
      product = row?.payload.product;
    } else {
      const table = {
        intelligence: growth.intelligence,
        task: growth.workflowTasks,
        run: growth.researchRuns,
        schedule: growth.researchSchedules,
      }[kind];
      const [row] = await this.database.db
        .select({ product: table.product })
        .from(table)
        .where(eq(table.id, id));
      product = row?.product;
    }
    if (product === undefined) throw new NotFoundException('记录不存在');
    await this.require(product, writable);
    return product;
  }
}
