import { describe, expect, it } from 'vitest';

import {
  mapFileContentToolQuery,
  mapPullRequestToolQuery,
} from '../../src/tools/providerMappers.js';
import { buildPullRequestSearchQuery } from '../../src/github/queryBuilders.js';

type PRArg = Parameters<typeof mapPullRequestToolQuery>[0];
type FileArg = Parameters<typeof mapFileContentToolQuery>[0];

describe('mapPullRequestToolQuery — PR search qualifiers reach the provider query', () => {
  // Regression: these 8 qualifiers were declared in the core schema and read by
  // buildPullRequestSearchQuery, but the mapper dropped them, so they were
  // silently ignored at runtime (accepted by Zod, never applied to the search).
  it('forwards milestone/language/checks/review/locked/visibility/team-mentions/project', () => {
    const out = mapPullRequestToolQuery({
      owner: 'facebook',
      repo: 'react',
      milestone: 'v18.0',
      language: 'typescript',
      checks: 'success',
      review: 'approved',
      locked: true,
      visibility: 'public',
      'team-mentions': 'facebook/react-core',
      project: 'facebook/1',
    } as PRArg) as Record<string, unknown>;

    expect(out.milestone).toBe('v18.0');
    expect(out.language).toBe('typescript');
    expect(out.checks).toBe('success');
    expect(out.review).toBe('approved');
    expect(out.locked).toBe(true);
    expect(out.visibility).toBe('public');
    expect(out.teamMentions).toBe('facebook/react-core');
    expect(out.project).toBe('facebook/1');
  });

  it('leaves the qualifiers undefined when not supplied', () => {
    const out = mapPullRequestToolQuery({
      owner: 'facebook',
      repo: 'react',
    } as PRArg) as Record<string, unknown>;

    expect(out.milestone).toBeUndefined();
    expect(out.review).toBeUndefined();
    expect(out.teamMentions).toBeUndefined();
  });
});

describe('buildPullRequestSearchQuery — qualifiers render into GitHub search syntax', () => {
  // End-of-chain proof: the params the mapper now forwards actually produce the
  // correct GitHub search qualifiers.
  it('emits review/milestone/checks/locked/visibility/team/project/language qualifiers', () => {
    const q = buildPullRequestSearchQuery({
      owner: 'facebook',
      repo: 'react',
      milestone: 'v18.0',
      language: 'typescript',
      checks: 'success',
      review: 'approved',
      locked: true,
      visibility: 'public',
      'team-mentions': 'facebook/react-core',
      project: 'facebook/1',
    });

    expect(q).toContain('review:approved');
    expect(q).toContain('milestone:"v18.0"');
    expect(q).toContain('status:success');
    expect(q).toContain('is:locked');
    expect(q).toContain('is:public');
    expect(q).toContain('team:facebook/react-core');
    expect(q).toContain('project:facebook/1');
    expect(q).toContain('language:typescript');
  });
});

describe('mapFileContentToolQuery — forceRefresh reaches the provider query', () => {
  // Regression: forceRefresh was dropped on the primary single-file read path,
  // so the documented cache-bypass never fired for normal file fetches.
  it('forwards forceRefresh:true so the GitHub cache can be bypassed', () => {
    const out = mapFileContentToolQuery({
      owner: 'facebook',
      repo: 'react',
      path: 'packages/react/index.js',
      forceRefresh: true,
    } as FileArg) as Record<string, unknown>;

    expect(out.forceRefresh).toBe(true);
  });

  it('is falsy when forceRefresh is not requested', () => {
    const out = mapFileContentToolQuery({
      owner: 'facebook',
      repo: 'react',
      path: 'packages/react/index.js',
    } as FileArg) as Record<string, unknown>;

    expect(out.forceRefresh).toBeFalsy();
  });
});
