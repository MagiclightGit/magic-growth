import { CompetitorProfilesService } from './competitor-profiles.service.js';
import { CompetitorProfilesController } from './competitor-profiles.controller.js';
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
import {
  watchInput,
  watchUpdate,
  watchConfigInput,
  manualSnapshot,
} from '@guangmo/contracts';
import { Roles, type AuthRequest } from '../auth/auth.guard.js';
import { parse } from '../../platform/validation.js';
import { CompetitorsService } from './competitors.service.js';
@Controller('competitors')
class CompetitorsController {
  constructor(
    @Inject(CompetitorsService) private readonly service: CompetitorsService,
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
    return this.service.create(parse(watchInput, body), req.member.id);
  }
  @Patch(':id') @Roles('admin', 'operator') toggle(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const input = parse(watchUpdate, body);
    return this.service.toggle(
      parse(z.uuid(), id),
      input.enabled,
      input.revision,
      req.member.id,
    );
  }
  @Patch(':id/config') @Roles('admin', 'operator') configure(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.configure(
      parse(z.uuid(), id),
      parse(watchConfigInput, body),
      req.member.id,
    );
  }
  @Post(':id/collect') @Roles('admin', 'operator') collect(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.collect(parse(z.uuid(), id), req.member.id);
  }
  @Post(':id/snapshots') @Roles('admin', 'operator') manual(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.manual(
      parse(z.uuid(), id),
      parse(manualSnapshot, body),
      req.member.id,
    );
  }
  @Post(':id/snapshots/:snapshotId/publish')
  @Roles('admin', 'operator')
  publish(
    @Param('id') id: string,
    @Param('snapshotId') snapshotId: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.publish(
      parse(z.uuid(), id),
      parse(z.uuid(), snapshotId),
      req.member.id,
    );
  }
}
@Module({
  controllers: [CompetitorsController, CompetitorProfilesController],
  providers: [CompetitorsService, CompetitorProfilesService],
})
export class CompetitorsModule {}
