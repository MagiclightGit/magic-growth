import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../platform/database.module.js';
import { Public } from '../auth/auth.guard.js';
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  @Get() @Public() health() {
    return { status: 'ok', service: 'guangmo-api' };
  }
  @Get('ready') @Public() async ready() {
    try {
      await this.database.db.execute(sql`select 1`);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('数据库暂不可用');
    }
  }
}
