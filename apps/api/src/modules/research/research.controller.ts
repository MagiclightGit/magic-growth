import type { Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { setTimeout as delay } from 'node:timers/promises';
import { AuthService } from '../auth/auth.service.js';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { researchInput, scheduleInput } from '@guangmo/contracts';
import { z } from 'zod';
import { Roles, type AuthRequest } from '../auth/auth.guard.js';
import { parse } from '../../platform/validation.js';
import { ResearchService } from './research.service.js';
@Controller()
export class ResearchController {
  constructor(
    @Inject(ResearchService) private readonly service: ResearchService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get('integrations') integrations() {
    return this.service.integration();
  }
  @Get('research') list() {
    return this.service.list();
  }
  @Get('research/:id') detail(@Param('id') id: string) {
    return this.service.detail(parse(z.uuid(), id));
  }
  @Get('research/:id/stream')
  async stream(
    @Param('id') id: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    const runId = parse(z.uuid(), id);
    let snapshot = await this.service.detail(runId);
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    let previous = '';
    let checkedAt = Date.now();
    try {
      while (!abort.signal.aborted) {
        if (Date.now() - checkedAt > 30000) {
          const session = await this.auth.auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
          });
          if (!session || session.user.disabled) break;
          checkedAt = Date.now();
        }
        const serialized = JSON.stringify(snapshot);
        if (serialized !== previous) {
          if (!res.write(`data: ${serialized}\n\n`)) break;
          previous = serialized;
        } else res.write(': heartbeat\n\n');
        if (snapshot.status === 'succeeded' || snapshot.status === 'failed')
          break;
        await delay(1000, undefined, { signal: abort.signal });
        snapshot = await this.service.detail(runId);
      }
    } catch {
      // Disconnects and transient database errors are recovered by EventSource.
    } finally {
      res.end();
    }
  }
  @Post('research') @Roles('admin', 'operator') create(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const input = parse(researchInput, body);
    return this.service.create(input.goal, req.member.id, input.product);
  }
  @Get('schedules') schedules() {
    return this.service.schedules();
  }
  @Post('schedules') @Roles('admin', 'operator') schedule(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.createSchedule(
      parse(scheduleInput, body),
      req.member.id,
    );
  }
  @Patch('schedules/:id') @Roles('admin', 'operator') toggle(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.toggleSchedule(
      parse(z.uuid(), id),
      parse(z.object({ enabled: z.boolean() }), body).enabled,
      req.member.id,
    );
  }
}
