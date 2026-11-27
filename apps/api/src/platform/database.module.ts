import {
  Global,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createDatabase } from '@guangmo/database';
import { env } from '../config/env.js';
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly connection = createDatabase(env.DATABASE_URL);
  readonly db = this.connection.db;
  async onApplicationShutdown() {
    await this.connection.pool.end();
  }
}
@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
