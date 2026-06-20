/**
 * Binary file inspection (format lane) — native, via octocode-engine.
 * Backs mode="inspect" and mode="strings" in localBinaryInspect.
 *
 * No GNU binutils/coreutils dependency: `goblin`-backed parsing and a native
 * string scanner replace the old `file` / `xxd` / `strings` shell-outs, so this
 * lane works on Windows and on distroless/Alpine Linux, returns parser-stable
 * structured data, and recovers UTF-16 strings GNU `strings -a` misses.
 */

import { contextUtils } from '../../utils/contextUtils.js';
import type {
  BinaryInspectInfo,
  BinaryStrings,
} from '@octocodeai/octocode-engine';

// ─── inspect ────────────────────────────────────────────────────────────────

export interface InspectResult {
  success: boolean;
  info?: BinaryInspectInfo;
  error?: string;
}

export function inspectBinaryFile(path: string): InspectResult {
  try {
    return { success: true, info: contextUtils.inspectBinaryNative(path) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ─── strings ──────────────────────────────────────────────────────────────────

export interface StringsResult {
  success: boolean;
  strings?: string[];
  totalFound?: number;
  /** True when the binary was larger than the scan cap and only its prefix was scanned. */
  truncated?: boolean;
  error?: string;
}

export function extractStrings(
  path: string,
  minLength: number,
  includeOffsets: boolean
): StringsResult {
  try {
    const result: BinaryStrings = contextUtils.extractBinaryStringsNative(
      path,
      minLength,
      includeOffsets
    );
    return {
      success: true,
      strings: result.strings,
      totalFound: result.totalFound,
      truncated: result.truncated,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
