import { Controller, Get, Req } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.guard.js';
@Controller('me')
export class ProfileController {
  @Get() me(@Req() req: AuthRequest) {
    return req.member;
  }
}
