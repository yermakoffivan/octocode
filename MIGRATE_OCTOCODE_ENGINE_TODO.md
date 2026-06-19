# Octocode Engine Migration TODO

Goal: merge `packages/octocode-engine` into renamed `packages/octocode-engine`, making `@octocodeai/octocode-engine` the single native runtime.

- [ ] Inspect workspace/package metadata and current native package shapes
- [ ] Rename `packages/octocode-engine` to `packages/octocode-engine`
- [ ] Move Rust LSP modules into `packages/octocode-engine/src/lsp`
- [ ] Merge Cargo dependencies/features and napi exports
- [ ] Move TypeScript LSP wrappers into `packages/octocode-engine/src/lsp`
- [ ] Update engine package exports, loader, package names, binary names, platform packages, scripts
- [ ] Update all imports/dependencies from `@octocodeai/octocode-engine` and `/octocode-engine`
- [ ] Remove old `packages/octocode-engine`
- [ ] Update docs/tests/references for new package name
- [ ] Run verification gates and report remaining failures
