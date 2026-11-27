import { z } from 'zod';
export const env = z
  .object({
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    WEB_ORIGIN: z.url(),
    API_PORT: z.coerce.number().default(3001),
    API_HOST: z.string().default('127.0.0.1'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.union([z.url(), z.literal('')]).optional(),
    RESEARCH_MODEL: z.string().optional(),
  })
  .parse(process.env);
