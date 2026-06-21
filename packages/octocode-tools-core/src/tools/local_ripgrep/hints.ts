import type { HintContext, ToolHintGenerators } from '../../types/metadata.js';

export const hints: ToolHintGenerators = {
  empty: (ctx: HintContext = {}) => {
    const c = ctx as Record<string, unknown>;
    if (c.mode === 'structural') {
      return [
        'No structural matches — the pattern must be a complete code fragment; $X = one node, $$$ARGS = a list.',
        'Relational rules (inside/has/not) need `stopBy: end` — without it they silently match nothing.',
        'Verify the extension is AST-supported (ts/tsx/js/py/go/rs/java/c/cpp/cs/sh) and widen the path.',
      ];
    }
    const path = typeof c.path === 'string' ? c.path : undefined;
    const langType =
      typeof c.langType === 'string'
        ? c.langType
        : typeof c.type === 'string'
          ? c.type
          : undefined;
    const include = Array.isArray(c.include) ? (c.include as unknown[]) : [];
    const excludeDir = Array.isArray(c.excludeDir)
      ? (c.excludeDir as unknown[])
      : [];
    const pattern = typeof c.keywords === 'string' ? c.keywords : undefined;
    const hasFilters = langType || include.length > 0 || excludeDir.length > 0;
    if (!pattern && !path && !hasFilters) return [];

    const baseHints = hasFilters
      ? [
          'Remove include/exclude/langType first, then retry a shorter or literal term.',
        ]
      : [
          'Try a shorter partial term, fixedString=true for literals, or search a parent directory.',
        ];

    return baseHints;
  },

  error: (ctx: HintContext = {}) => {
    if (ctx.errorType === 'size_limit') {
      const count = ctx.matchCount ? ` (${ctx.matchCount} matches)` : '';
      return [
        `Too many results${count} — narrow, add a filter, or use fixedString=true.`,
      ];
    }
    if (ctx.errorType === 'not_found') {
      return ['Path not found — verify with localViewStructure.'];
    }
    return [];
  },
};
