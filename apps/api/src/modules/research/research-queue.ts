import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { RESEARCH_QUEUE, redisConnection } from '@guangmo/contracts';
import { env } from '../../config/env.js';
@Injectable()
export class ResearchQueue implements OnApplicationShutdown {
  private readonly redis = new Redis({
    ...redisConnection(env.REDIS_URL),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  readonly queue = new Queue(RESEARCH_QUEUE, {
    connection: this.redis,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  });
  constructor() {
    this.redis.on('error', () => {});
    this.queue.on('error', () => {});
  }
  async integration() {
    let queueAvailable = false;
    try {
      await this.queue.getJobCounts('waiting');
      queueAvailable = true;
    } catch {
      /* integration is shown as unavailable */
    }
    return {
      agentConfigured: Boolean(env.OPENAI_API_KEY && env.RESEARCH_MODEL),
      queueAvailable,
    };
  }
  async onApplicationShutdown() {
    await this.queue.close();
    this.redis.disconnect();
  }
}
