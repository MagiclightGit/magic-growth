import { z } from 'zod';
import { candidateInput, extractionOutput } from '@guangmo/contracts';

// Some OpenAI-compatible relays reject JSON Schema's URI/date-time formats.
// Use plain strings on the wire, then enforce the full domain contract locally.
export const extractionModelOutput = extractionOutput.extend({
  candidates: extractionOutput.shape.candidates.element
    .omit({ sourceTimes: true, eventStartsAt: true, eventEndsAt: true })
    .extend({
      publishedAt: z.string().nullable(),
      sources: candidateInput.shape.sources.element
        .extend({ url: z.string() })
        .array()
        .min(1)
        .max(10),
    })
    .array()
    .max(10),
});

export const timedExtractionModelOutput = extractionModelOutput.extend({
  candidates: extractionModelOutput.shape.candidates.element
    .extend({
      eventStartsAt: z.string().nullable(),
      eventEndsAt: z.string().nullable(),
    })
    .array()
    .max(10),
});
