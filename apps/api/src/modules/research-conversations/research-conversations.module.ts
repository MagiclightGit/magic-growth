import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import {
  conversationCreate,
  conversationMessage,
  conversationSource,
} from '@guangmo/contracts';
import { Roles, type AuthRequest } from '../auth/auth.guard.js';
import { parse } from '../../platform/validation.js';
import { ResearchConversationsService } from './research-conversations.service.js';
@Controller('research-conversations')
class ResearchConversationsController {
  constructor(
    @Inject(ResearchConversationsService)
    private readonly service: ResearchConversationsService,
  ) {}
  @Get() list(@Query() q: unknown, @Req() req: AuthRequest) {
    return this.service.list(parse(conversationSource, q), req.member.id);
  }
  @Get('shared') shared(@Query() q: unknown) {
    return this.service.shared(parse(conversationSource, q));
  }
  @Post() @Roles('admin', 'operator') create(
    @Body() b: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.create(parse(conversationCreate, b), req.member.id);
  }
  @Get(':id') detail(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.service.detail(parse(z.uuid(), id), req.member.id);
  }
  @Post(':id/messages') @Roles('admin', 'operator') send(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.send(
      parse(z.uuid(), id),
      parse(conversationMessage, b),
      req.member.id,
    );
  }
  @Post(':id/messages/:turn/retry') @Roles('admin', 'operator') retry(
    @Param('id') id: string,
    @Param('turn') turn: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.retry(
      parse(z.uuid(), id),
      parse(z.uuid(), turn),
      req.member.id,
    );
  }
  @Post(':id/messages/:turn/share') @Roles('admin', 'operator') share(
    @Param('id') id: string,
    @Param('turn') turn: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.share(
      parse(z.uuid(), id),
      parse(z.uuid(), turn),
      req.member.id,
    );
  }
}
@Module({
  controllers: [ResearchConversationsController],
  providers: [ResearchConversationsService],
})
export class ResearchConversationsModule {}
