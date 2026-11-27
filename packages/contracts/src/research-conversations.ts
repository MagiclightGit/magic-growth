import { z } from 'zod';
import type { ResearchEventData } from './index.js';
export const conversationSource = z.object({
  sourceKind: z.enum(['competitor', 'research']),
  sourceId: z.uuid(),
});
export const conversationCreate = conversationSource.extend({
  requestId: z.uuid(),
});
export const conversationMessage = z.object({
  requestId: z.uuid(),
  text: z.string().trim().min(2).max(4000),
  mode: z.enum(['discuss', 'research']).default('discuss'),
});
export type ConversationSource = z.infer<typeof conversationSource>;
export interface ConversationContext extends ConversationSource {
  title: string;
  report: string;
  collectedAt: string;
}
export interface ResearchConversation extends ConversationSource {
  id: string;
  product: string;
  title: string;
  createdAt: string;
}
export interface ConversationTurn {
  id: string;
  conversationId: string;
  sequence: number;
  question: string;
  mode: 'discuss' | 'research';
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  answer: string | null;
  error: string | null;
  generation: number;
  attempts: number;
  model: string | null;
  createdAt: string;
  completedAt: string | null;
  events: {
    id: string;
    message: string;
    data: ResearchEventData | null;
    createdAt: string;
  }[];
  sharedId: string | null;
}
export interface ConversationDetail extends ResearchConversation {
  context: ConversationContext;
  turns: ConversationTurn[];
}
export interface SharedResearchSupplement extends ConversationSource {
  id: string;
  question: string;
  answer: string;
  authorName: string;
  createdAt: string;
  sources: { url: string; title?: string }[];
}
export const CONVERSATION_MAX_TURNS = 100;
export const CONVERSATION_REPORT_AND_QUESTION_LIMIT = 100_000;
