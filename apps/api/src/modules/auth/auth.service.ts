import { Inject, Injectable } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { schema } from '@guangmo/database';
import { DatabaseService } from '../../platform/database.module.js';
import { env } from '../../config/env.js';
@Injectable()
export class AuthService {
  readonly auth;
  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.auth = betterAuth({
      appName: '光魔增长',
      database: drizzleAdapter(database.db, {
        provider: 'pg',
        schema,
        transaction: true,
      }),
      trustedOrigins: [env.WEB_ORIGIN],
      emailAndPassword: {
        enabled: true,
        disableSignUp: true,
        minPasswordLength: 12,
        revokeSessionsOnPasswordReset: true,
      },
      user: {
        additionalFields: {
          role: { type: 'string', defaultValue: 'viewer', input: false },
          disabled: { type: 'boolean', defaultValue: false, input: false },
        },
      },
      session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
      rateLimit: { enabled: true, storage: 'memory' },
    });
  }
}
