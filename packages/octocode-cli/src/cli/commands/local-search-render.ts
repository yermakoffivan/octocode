import { c, bold, dim } from '../../utils/colors.js';

export interface LocalMatch {
  path?: string;
  matchCount?: number;
  matches?: Array<{ value?: string; line?: number }>;
}

export interface LocalPagination {
  totalFiles?: number;
  page?: number;
  totalPages?: number;
}

export interface LocalSearchResult {
  results?: Array<{
    data?: { files?: LocalMatch[]; pagination?: LocalPagination };
  }>;
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
  const pagination = sc?.results?.[0]?.data?.pagination;
  const files = sc?.results?.[0]?.data?.files ?? [];
  const total = pagination?.totalFiles ?? files.length;
  const lines: string[] = [];
  const shown = files.slice(0, limit);
  for (const f of shown) {
    lines.push(
      `  ${c('cyan', bold(f.path ?? ''))}  ${dim(`(${f.matchCount ?? 0} matches)`)}`
    );
    (f.matches ?? []).slice(0, 5).forEach(m => {
      const lineNum = m.line != null ? m.line : '?';
      const snippet = (m.value ?? '').trim().slice(0, 120);
      lines.push(`    ${c('yellow', `L${lineNum}:`)} ${snippet}`);
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
