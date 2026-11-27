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
  dramaInput,
  dramaEdit,
  observationInput,
  observationImportInput,
  originalScriptInput,
} from '@guangmo/contracts';
import { Roles, type AuthRequest } from '../auth/auth.guard.js';
import { parse } from '../../platform/validation.js';
import { DramasService } from './dramas.service.js';
@Controller('dramas')
class DramasController {
  constructor(@Inject(DramasService) private readonly service: DramasService) {}
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
    return this.service.create(parse(dramaInput, body), req.member.id);
  }
  @Patch(':id') @Roles('admin', 'operator') edit(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const input = parse(dramaEdit, body);
    return this.service.edit(
      parse(z.uuid(), id),
      input.data,
      input.revision,
      req.member.id,
    );
  }
  @Post(':id/observations') @Roles('admin', 'operator') observe(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.observe(
      parse(z.uuid(), id),
      parse(observationInput, body),
      req.member.id,
    );
  }
  @Post(':id/script') @Roles('admin', 'operator') script(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.script(
      parse(z.uuid(), id),
      parse(originalScriptInput, body),
      req.member.id,
    );
  }
  @Post(':id/observations/import')
  @Roles('admin', 'operator')
  importObservations(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.importObservations(
      parse(z.uuid(), id),
      parse(observationImportInput, body),
      req.member.id,
    );
  }
  @Post(':id/candidate') @Roles('admin', 'operator') candidate(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.candidate(parse(z.uuid(), id), req.member.id);
  }
}
@Module({ controllers: [DramasController], providers: [DramasService] })
export class DramasModule {}
