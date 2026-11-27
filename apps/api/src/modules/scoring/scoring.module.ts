import { ProductAccess } from '../products/product-access.service.js';
import {
  Controller,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  Body,
  Req,
  ConflictException,
} from '@nestjs/common';
import { z } from 'zod';
import { requestScore } from '@guangmo/database';
import { scoringRequest } from '@guangmo/contracts';
import { DatabaseService } from '../../platform/database.module.js';
import { parse } from '../../platform/validation.js';
import { Roles, type AuthRequest } from '../auth/auth.guard.js';
import { env } from '../../config/env.js';
@Controller('scoring')
class ScoringController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProductAccess) private readonly access: ProductAccess,
  ) {}
  @Post(':type/:id') @Roles('admin', 'operator') async request(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const target = parse(z.enum(['candidate', 'intelligence']), type);
    const input = parse(scoringRequest, body);
    await this.access.requireTarget(target, parse(z.uuid(), id), true);
    if (!env.OPENAI_API_KEY || !env.RESEARCH_MODEL)
      throw new ConflictException('请先配置模型服务');
    const row = await requestScore(
      this.database.db,
      target,
      parse(z.uuid(), id),
      req.member.id,
      input.context,
    );
    if (!row) throw new NotFoundException('情报不存在');
    return { id: row.id, status: row.status };
  }
}
@Module({ controllers: [ScoringController] })
export class ScoringModule {}
