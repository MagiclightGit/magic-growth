import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { feedSourceInput } from '@guangmo/contracts';
import { parse } from '../../platform/validation.js';
import { Roles, type AuthRequest } from '../auth/auth.guard.js';
import { SourcesService } from './sources.service.js';

@Controller('sources')
class SourcesController {
  constructor(
    @Inject(SourcesService) private readonly service: SourcesService,
  ) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id/runs')
  history(@Param('id') id: string) {
    return this.service.history(parse(z.uuid(), id));
  }

  @Post()
  @Roles('admin')
  create(@Body() body: unknown, @Req() req: AuthRequest) {
    return this.service.create(parse(feedSourceInput, body), req.member.id);
  }

  @Patch(':id')
  @Roles('admin')
  toggle(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const change = parse(
      z.object({ enabled: z.boolean(), revision: z.number().int().min(0) }),
      body,
    );
    return this.service.toggle(parse(z.uuid(), id), change, req.member.id);
  }

  @Post(':id/runs')
  @Roles('admin')
  collect(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.service.collect(parse(z.uuid(), id), req.member.id);
  }
}

@Module({ controllers: [SourcesController], providers: [SourcesService] })
export class SourcesModule {}
