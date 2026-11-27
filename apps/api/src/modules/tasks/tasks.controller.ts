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
import { taskInput, taskUpdateInput } from '@guangmo/contracts';
import { Roles, type AuthRequest } from '../auth/auth.guard.js';
import { parse } from '../../platform/validation.js';
import { TasksService } from './tasks.service.js';
@Controller()
export class TasksController {
  constructor(@Inject(TasksService) private readonly service: TasksService) {}
  @Get('tasks') list() {
    return this.service.list();
  }
  @Get('tasks/assignees') assignees() {
    return this.service.assignees();
  }
  @Get('tasks/:id') detail(@Param('id') id: string) {
    return this.service.detail(parse(z.uuid(), id));
  }
  @Post('intelligence/:id/tasks') @Roles('admin', 'operator') create(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.create(
      parse(z.uuid(), id),
      parse(taskInput, body),
      req.member.id,
    );
  }
  @Patch('tasks/:id') @Roles('admin', 'operator') update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.update(
      parse(z.uuid(), id),
      parse(taskUpdateInput, body),
      req.member.id,
    );
  }
}
