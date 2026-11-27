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
import { z } from 'zod';
import {
  candidateEditInput,
  candidateStatus,
  manualCandidateInput,
  reviewInput,
} from '@guangmo/contracts';
import { Roles, type AuthRequest } from '../auth/auth.guard.js';
import { parse } from '../../platform/validation.js';
import { CandidatesService } from './candidates.service.js';
@Controller()
export class CandidatesController {
  constructor(
    @Inject(CandidatesService) private readonly service: CandidatesService,
  ) {}
  @Get('candidates') list(
    @Query('status') status?: string,
    @Query('runId') runId?: string,
    @Query('id') id?: string,
  ) {
    return this.service.list(
      parse(candidateStatus.optional(), status),
      parse(z.uuid().optional(), runId || undefined),
      parse(z.uuid().optional(), id || undefined),
    );
  }
  @Post('candidates') @Roles('admin', 'operator') create(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.create(
      parse(manualCandidateInput, body),
      req.member.id,
    );
  }
  @Get('research/:id/candidates') batch(@Param('id') id: string) {
    return this.service.batch(parse(z.uuid(), id));
  }
  @Post('research/:id/extraction') @Roles('admin', 'operator') extract(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.requestExtraction(parse(z.uuid(), id), req.member.id);
  }
  @Patch('candidates/:id') @Roles('admin', 'operator') edit(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const input = parse(candidateEditInput, body);
    return this.service.edit(
      parse(z.uuid(), id),
      input.revision,
      input.candidate,
      req.member.id,
    );
  }
  @Post('candidates/:id/review') @Roles('admin', 'operator') review(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const input = parse(reviewInput, body);
    return this.service.review(parse(z.uuid(), id), input, req.member.id);
  }
}
