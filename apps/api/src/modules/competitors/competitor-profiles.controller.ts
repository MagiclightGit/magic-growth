import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import {
  competitorProfileInput,
  competitorProfileEdit,
  competitorFinding,
} from '@guangmo/contracts';
import { parse } from '../../platform/validation.js';
import { Roles, type AuthRequest } from '../auth/auth.guard.js';
import { CompetitorProfilesService } from './competitor-profiles.service.js';
@Controller('competitor-profiles')
export class CompetitorProfilesController {
  constructor(
    @Inject(CompetitorProfilesService)
    private readonly service: CompetitorProfilesService,
  ) {}
  @Get() list() {
    return this.service.list();
  }
  @Get(':id') detail(@Param('id') id: string) {
    return this.service.detail(parse(z.uuid(), id));
  }
  @Post() @Roles('admin', 'operator') create(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.create(
      parse(competitorProfileInput, body),
      req.member.id,
    );
  }
  @Patch(':id') @Roles('admin', 'operator') edit(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.edit(
      parse(z.uuid(), id),
      parse(competitorProfileEdit, body),
      req.member.id,
    );
  }
  @Post(':id/research') @Roles('admin', 'operator') start(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.start(parse(z.uuid(), id), req.member.id);
  }
  @Get(':id/runs/:run') run(
    @Param('id') id: string,
    @Param('run') run: string,
  ) {
    return this.service.run(parse(z.uuid(), id), parse(z.uuid(), run));
  }
  @Post(':id/runs/:run/retry') @Roles('admin', 'operator') retry(
    @Param('id') id: string,
    @Param('run') run: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.retry(
      parse(z.uuid(), id),
      parse(z.uuid(), run),
      req.member.id,
    );
  }
  @Post(':id/runs/:run/publish') @Roles('admin', 'operator') publish(
    @Param('id') id: string,
    @Param('run') run: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.publish(
      parse(z.uuid(), id),
      parse(z.uuid(), run),
      parse(z.object({ dimension: competitorFinding.shape.dimension }), body)
        .dimension,
      req.member.id,
    );
  }
}
