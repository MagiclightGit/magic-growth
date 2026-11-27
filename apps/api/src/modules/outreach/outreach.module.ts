import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  creatorCsv,
  creatorInput,
  outreachFollowupInput,
  outreachSendInput,
  productId,
} from '@guangmo/contracts';
import { z } from 'zod';
import { Roles, type AuthRequest } from '../auth/auth.guard.js';
import { ProductAccess } from '../products/product-access.service.js';
import { parse } from '../../platform/validation.js';
import { CreatorsService } from './creators.service.js';
import { MailService } from './mail.service.js';

@Controller('outreach')
class OutreachController {
  constructor(
    @Inject(ProductAccess) private readonly access: ProductAccess,
    @Inject(CreatorsService) private readonly creators: CreatorsService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  private async require(raw: string, write = false) {
    const product = parse(productId, raw);
    await this.access.require(product, write);
    return product;
  }

  @Get('mailbox') mailbox(@Req() req: AuthRequest) {
    return this.mail.mailbox(req.member.role !== 'viewer');
  }

  @Post('mailbox/pause') @Roles('admin') pause(@Body() body: unknown) {
    return this.mail.pause(
      parse(z.object({ paused: z.boolean() }), body).paused,
    );
  }

  @Get(':product/creators') async list(
    @Param('product') raw: string,
    @Query('before') before?: string,
  ) {
    const product = await this.require(raw);
    return this.creators.list(product, parse(z.uuid().optional(), before));
  }

  @Post(':product/creators') @Roles('admin', 'operator') async create(
    @Param('product') raw: string,
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.creators.create(
      await this.require(raw, true),
      req.member.id,
      parse(creatorInput, body),
    );
  }

  @Get(':product/creators/:id') async detail(
    @Param('product') raw: string,
    @Param('id') id: string,
  ) {
    return this.mail.list(await this.require(raw), parse(z.uuid(), id));
  }

  @Get(':product/batches/:id') async batch(
    @Param('product') raw: string,
    @Param('id') id: string,
  ) {
    const [batch] = await this.creators.batch(
      await this.require(raw),
      parse(z.uuid(), id),
    );
    if (!batch) throw new NotFoundException('导入批次不存在');
    return batch;
  }

  @Post(':product/batches/preview') @Roles('admin', 'operator') async preview(
    @Param('product') raw: string,
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.creators.import(
      await this.require(raw, true),
      req.member.id,
      parse(creatorCsv, body),
      true,
    );
  }

  @Post(':product/batches') @Roles('admin', 'operator') async import(
    @Param('product') raw: string,
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.creators.import(
      await this.require(raw, true),
      req.member.id,
      parse(creatorCsv, body),
      false,
    );
  }

  @Post(':product/messages') @Roles('admin', 'operator') async send(
    @Param('product') raw: string,
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.mail.enqueue(
      await this.require(raw, true),
      req.member.id,
      parse(outreachSendInput, body),
    );
  }

  @Post(':product/messages/:id/followup')
  @Roles('admin', 'operator')
  async followup(
    @Param('product') raw: string,
    @Param('id') id: string,
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.mail.followup(
      await this.require(raw, true),
      parse(z.uuid(), id),
      req.member.id,
      parse(outreachFollowupInput, body),
    );
  }

  @Post(':product/messages/:id/unsubscribe')
  @Roles('admin', 'operator')
  async unsubscribe(@Param('product') raw: string, @Param('id') id: string) {
    return this.mail.unsubscribe(
      await this.require(raw, true),
      parse(z.uuid(), id),
    );
  }

  @Post(':product/messages/:id/retry') @Roles('admin') async retry(
    @Param('product') raw: string,
    @Param('id') id: string,
  ) {
    return this.mail.retry(await this.require(raw, true), parse(z.uuid(), id));
  }
}

@Module({
  controllers: [OutreachController],
  providers: [CreatorsService, MailService],
})
export class OutreachModule {}
