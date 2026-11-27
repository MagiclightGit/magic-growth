import { Controller, Get, Inject, Module } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import { dailyBriefs } from '@guangmo/database';
import { DatabaseService } from '../../platform/database.module.js';
import { ProductAccess } from '../products/product-access.service.js';

@Controller('briefs')
class BriefsController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProductAccess) private readonly access: ProductAccess,
  ) {}

  @Get()
  async list() {
    const rows = await this.database.db
      .select()
      .from(dailyBriefs)
      .where(this.access.condition(dailyBriefs.product))
      .orderBy(desc(dailyBriefs.businessDate), dailyBriefs.product)
      .limit(60);
    return rows.map(({ content, ...row }) => ({ ...row, ...content }));
  }
}

@Module({ controllers: [BriefsController] })
export class BriefsModule {}
