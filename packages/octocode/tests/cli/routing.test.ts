import { describe, it, expect } from 'vitest';
import {
  resolveRef,
  isGithubRef,
  refLabel,
  cloneCommandFor,
  type GithubRef,
} from '../../src/cli/routing.js';

function gh(input: string): GithubRef {
  const ref = resolveRef(input);
  if (!isGithubRef(ref)) {
    throw new Error(`expected a GitHub ref for "${input}", got ${ref.kind}`);
  }
  return ref;
}

describe('resolveRef — GitHub ref parsing', () => {
  it('parses owner/repo with no subpath or branch', () => {
    const ref = gh('facebook/react');
    expect(ref).toMatchObject({
      owner: 'facebook',
      repo: 'react',
      subpath: '',
    });
    expect(ref.branch).toBeUndefined();
  });

  it('parses owner/repo/path (sparse subtree, no branch)', () => {
    const ref = gh('facebook/react/packages/react');
    expect(ref).toMatchObject({
      owner: 'facebook',
      repo: 'react',
      subpath: 'packages/react',
    });
    expect(ref.branch).toBeUndefined();
  });

  it('parses owner/repo@branch (branch, no subpath)', () => {
    const ref = gh('facebook/react@main');
    expect(ref).toMatchObject({
      owner: 'facebook',
      repo: 'react',
      subpath: '',
      branch: 'main',
    });
  });

  it('parses owner/repo@branch/path (branch before path)', () => {
    const ref = gh('facebook/react@main/packages/react');
    expect(ref).toMatchObject({
      owner: 'facebook',
      repo: 'react',
      subpath: 'packages/react',
      branch: 'main',
    });
  });

  // Regression: the form documented in top-level help and emitted by
  // refLabel/cloneCommandFor — branch trailing after the subpath. Previously
  // this mis-parsed "path@branch" into the subpath with no branch.
  it('parses owner/repo/path@branch (trailing branch)', () => {
    const ref = gh('facebook/react/packages/react@main');
    expect(ref).toMatchObject({
      owner: 'facebook',
      repo: 'react',
      subpath: 'packages/react',
      branch: 'main',
    });
  });

  it('parses GitHub tree URLs', () => {
    const ref = gh(
      'https://github.com/facebook/react/tree/main/packages/react'
    );
    expect(ref).toMatchObject({
      owner: 'facebook',
      repo: 'react',
      subpath: 'packages/react',
      branch: 'main',
    });
  });

  it('round-trips refLabel/cloneCommandFor output back through the parser', () => {
    const original = gh('facebook/react/packages/react@main');
    const reparsed = gh(refLabel(original));
    expect(reparsed).toMatchObject({
      owner: original.owner,
      repo: original.repo,
      subpath: original.subpath,
      branch: original.branch,
    });
    // cloneCommandFor prefixes "clone "; the ref portion must also re-parse.
    const cloneCmd = cloneCommandFor(original);
    expect(cloneCmd.startsWith('clone ')).toBe(true);
    const reparsedFromClone = gh(cloneCmd.slice('clone '.length));
    expect(reparsedFromClone).toMatchObject({
      owner: original.owner,
      repo: original.repo,
      subpath: original.subpath,
      branch: original.branch,
    });
  });
});
