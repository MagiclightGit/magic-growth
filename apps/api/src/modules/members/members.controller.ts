import { ProductAccess } from '../products/product-access.service.js';
import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import { auth } from '@guangmo/database';
import { memberInput } from '@guangmo/contracts';
import { DatabaseService } from '../../platform/database.module.js';
import { Roles, type AuthRequest } from '../auth/auth.guard.js';
import { parse } from '../../platform/validation.js';
import { provisionMember } from './provision-member.js';
@Controller('members')
@Roles('admin')
export class MembersController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProductAccess) private readonly access: ProductAccess,
  ) {}
  @Get() list() {
    return this.database.db
      .select({
        id: auth.user.id,
        name: auth.user.name,
        email: auth.user.email,
        role: auth.user.role,
        disabled: auth.user.disabled,
      })
      .from(auth.user);
  }
  @Post() async create(@Body() body: unknown, @Req() req: AuthRequest) {
    const input = parse(memberInput, body);
    for (const product of input.productIds) await this.access.require(product);
    try {
      return await provisionMember(this.database.db, input, req.member.id);
    } catch (error) {
      if ((error as { cause?: { code?: string } }).cause?.code === '23505')
        throw new ConflictException('该邮箱已存在');
      throw error;
    }
  }
}
