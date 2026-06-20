import { z } from 'zod';
import { RipgrepQuerySchema as CoreRipgrepQuerySchema } from '@octocodeai/octocode-core/schemas';
import { MAX_MATCH_CONTENT_LENGTH, MAX_PAGE_NUMBER } from '../../config.js';
import {
  clampedInt,
  contextLinesField,
  createRelaxedBulkQuerySchema,
  relaxedPageNumberField,
} from '../../scheme/fields.js';
import {
  createQueryShapeSchema,
  describeQuerySchema,
} from '../../scheme/coreSchemas.js';

const queryOverrides = {
  contextLines: contextLinesField,
  matchContentLength: clampedInt(1, MAX_MATCH_CONTENT_LENGTH)
    .optional()
    .default(500),
  maxMatchesPerFile: clampedInt(1, MAX_MATCH_CONTENT_LENGTH).optional(),
  maxFiles: clampedInt(1, MAX_MATCH_CONTENT_LENGTH).optional(),
  matchPage: relaxedPageNumberField.optional(),
  itemsPerPage: clampedInt(1, MAX_PAGE_NUMBER).optional(),
  page: relaxedPageNumberField.default(1),
  unique: z
    .boolean()
    .optional()
    .describe('With onlyMatching, return each matched value once per file.'),
  countUnique: z
    .boolean()
    .optional()
    .describe(
      'With onlyMatching, return each matched value once per file with its frequency.'
    ),
} as const;

const RipgrepQueryShape = createQueryShapeSchema(
  CoreRipgrepQuerySchema,
  queryOverrides
);

// Structural-mode validation (exactly one of pattern/rule, reject ripgrep-only
// fields, require keywords otherwise) is enforced by the core RipgrepQuerySchema
// superRefine, which describeQuerySchema preserves through to this schema.
const LocalRipgrepBaseQuerySchema = describeQuerySchema(
  CoreRipgrepQuerySchema,
  queryOverrides,
  { strict: true }
);

export const LocalRipgrepQuerySchema = LocalRipgrepBaseQuerySchema.superRefine(
  (query, ctx) => {
    const ripgrepQuery = query as typeof query & {
      unique?: boolean;
      countUnique?: boolean;
    };
    if (ripgrepQuery.mode === 'structural') {
      for (const field of ['unique', 'countUnique'] as const) {
        if (ripgrepQuery[field]) {
          ctx.addIssue({
            code: 'custom',
            message: `\`${field}\` is not valid with mode:"structural".`,
            path: [field],
          });
        }
      }
      return;
    }

    if (ripgrepQuery.unique && !ripgrepQuery.onlyMatching) {
      ctx.addIssue({
        code: 'custom',
        message: 'unique requires onlyMatching:true.',
        path: ['unique'],
      });
    }
    if (ripgrepQuery.countUnique && !ripgrepQuery.onlyMatching) {
      ctx.addIssue({
        code: 'custom',
        message: 'countUnique requires onlyMatching:true.',
        path: ['countUnique'],
      });
    }
  }
);

export type RipgrepQuery = z.infer<typeof LocalRipgrepQuerySchema> & {
  unique?: boolean;
  countUnique?: boolean;
};

export const LocalRipgrepBulkQuerySchema = createRelaxedBulkQuerySchema(
  RipgrepQueryShape,
  { maxQueries: 5 }
);
