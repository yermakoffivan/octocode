import { c, bold, dim } from '../../utils/colors.js';

export interface LocalMatch {
  path?: string;
  matchCount?: number;
  matches?: Array<{
    value?: string;
    line?: number;
    metavars?: Record<string, string[]>;
  }>;
}

export interface LocalPagination {
  totalFiles?: number;
  page?: number;
  totalPages?: number;
}

export interface LocalSearchResult {
  results?: Array<{
    data?: {
      files?: LocalMatch[];
      pagination?: LocalPagination;
      // Common per-file scalars are hoisted here when identical across files
      // (e.g. structural/AST results share one matchCount). Must be merged back.
      shared?: { matchCount?: number };
    };
  }>;
}

function formatMetavars(
  metavars: Record<string, string[]> | undefined
): string {
  if (!metavars) return '';
  const parts = Object.entries(metavars)
    .filter(([, values]) => values.length > 0)
    .slice(0, 3)
    .map(([name, values]) => {
      const preview = values.join(', ').replace(/\s+/g, ' ').slice(0, 80);
      return `$${name}=${preview}`;
    });
  return parts.length > 0 ? `[${parts.join('; ')}]` : '';
}

/**
 * Renders localSearchCode hits (text or structural/AST — same envelope shape)
 * into a compact `path (n matches)` + `Lnn: snippet` listing. Shared by the
 * `grep` (text) and `ast` (structural) commands.
 */
export function renderLocalResults(
  sc: LocalSearchResult,
  limit: number
): string {
  const data = sc?.results?.[0]?.data;
  const pagination = data?.pagination;
  const files = data?.files ?? [];
  const sharedCount = data?.shared?.matchCount;
  const total = pagination?.totalFiles ?? files.length;
  const lines: string[] = [];
  const shown = files.slice(0, limit);
  for (const f of shown) {
    // Prefer the per-file count; fall back to a hoisted shared count, then to
    // the number of returned matches so the header is never wrongly "0".
    const count = f.matchCount ?? sharedCount ?? f.matches?.length ?? 0;
    lines.push(
      `  ${c('cyan', bold(f.path ?? ''))}  ${dim(`(${count} matches)`)}`
    );
    (f.matches ?? []).slice(0, 5).forEach(m => {
      const lineNum = m.line != null ? m.line : '?';
      const snippet = (m.value ?? '').trim().slice(0, 120);
      const metavars = formatMetavars(m.metavars);
      lines.push(
        `    ${c('yellow', `L${lineNum}:`)} ${snippet}${metavars ? ` ${dim(metavars)}` : ''}`
      );
    });
  }
  if (total > shown.length) {
    lines.push(`\n  ${dim(`… ${total - shown.length} more files`)}`);
  }
  if (pagination?.totalPages && pagination.totalPages > 1) {
    lines.push(
      `\n  ${dim(`Page ${pagination.page ?? 1}/${pagination.totalPages} — use --page <n> to navigate`)}`
    );
  }
  if (lines.length === 0) lines.push(`  ${dim('No matches found.')}`);
  return lines.join('\n');
}
