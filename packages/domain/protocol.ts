import { z } from 'zod';
import { feedbackValues, intents, type State, type Session, type Validation } from './index';
import type { CopilotReviewState } from '../workflow-engine/copilot-review';
export const messageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum([
      'ready',
      'demo',
      'analyze',
      'import',
      'importPrevious',
      'discoverDemo',
      'pause',
      'resume',
      'privacy',
      'exportData',
      'deleteAll',
      'deleteImported',
      'startSession',
      'stopSession',
    ]),
  }),
  z.object({
    type: z.literal('consent'),
    mode: z.enum(['off', 'demo-only', 'metadata-only', 'user-imported-content']),
  }),
  z.object({
    type: z.enum(['generate', 'validate', 'export', 'deleteSession']),
    id: z.string().max(4000),
  }),
  z.object({
    type: z.literal('approveSessions'),
    ids: z.array(z.string().max(4000)).max(500),
    analyze: z.boolean().optional(),
  }),
  z.object({ type: z.literal('discardPending') }),
  z.object({ type: z.literal('copilotConsent'), enabled: z.boolean() }),
  z.object({
    type: z.literal('correct'),
    sessionId: z.string().max(4000),
    eventId: z.string().max(4000),
    intent: z.enum(intents),
  }),
  z.object({
    type: z.literal('feedback'),
    id: z.string().max(4000),
    value: z.enum(feedbackValues),
  }),
  z.object({
    type: z.literal('saveDraft'),
    id: z.string().max(4000),
    name: z.string().max(64),
    files: z
      .record(z.string().max(200), z.string().max(100_000))
      .refine((files) => Object.keys(files).length <= 12),
    status: z.enum(['review', 'approved', 'rejected', 'later']),
  }),
  z.object({
    type: z.literal('settings'),
    idleMinutes: z.number().int().min(1).max(240),
    retentionDays: z.number().int().min(1).max(365),
  }),
]);
export type Message = z.infer<typeof messageSchema>;
export interface Snapshot {
  copilot?: CopilotReviewState;
  state: State;
  pending: Session[];
  validation?: Validation;
  notice: string;
  browser: boolean;
  view?: string;
}
