import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  intelligenceInput,
  intelligenceStatus,
  intelligenceListFilters,
  intelligenceOwnerInput,
} from '@guangmo/contracts';
import { z } from 'zod';
import { Roles, type AuthRequest } from '../auth/auth.guard.js';
import { parse } from '../../platform/validation.js';
import { IntelligenceService } from './intelligence.service.js';
@Controller()
export class IntelligenceController {
  constructor(
    @Inject(IntelligenceService) private readonly service: IntelligenceService,
  ) {}
  @Get('overview') overview() {
    return this.service.overview();
  }
  @Get('intelligence') list(@Query() query: Record<string, unknown>) {
    const clean = Object.fromEntries(
      Object.entries(query).filter(([, value]) => value !== ''),
    );
    return this.service.list(parse(intelligenceListFilters, clean));
  }
  @Get('intelligence/assignees') assignees() {
    return this.service.assignees();
  }
  @Patch('intelligence/:id/owner') @Roles('admin', 'operator') assign(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const input = parse(intelligenceOwnerInput, body);
    return this.service.assign(
      parse(z.uuid(), id),
      input.ownerId,
      input.revision,
      req.member.id,
    );
  }
  @Get('intelligence/:id') detail(@Param('id') id: string) {
    return this.service.detail(parse(z.uuid(), id));
  }
  @Post('intelligence') @Roles('admin', 'operator') create(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.create(parse(intelligenceInput, body), req.member.id);
  }
  @Patch('intelligence/:id/status') @Roles('admin', 'operator') update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.updateStatus(
      parse(z.uuid(), id),
      parse(z.object({ status: intelligenceStatus }), body).status,
      req.member.id,
    );
  }
}
