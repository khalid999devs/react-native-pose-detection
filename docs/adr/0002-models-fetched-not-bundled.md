# 0002 — Models fetched at prebuild, not bundled

**Status:** accepted
**Date:** 2026-08-12

## Context

MediaPipe pose models are 5.5 MB (lite), 9.0 MB (full), and 29.2 MB (heavy). Three options:

1. Bundle one in the npm tarball — what the legacy package did. 94% of its 9.57 MB published
   size was a model file no consumer could opt out of, and no variant choice was possible.
2. Require the developer to supply it — what competing libraries do. It is consistently the
   step where people abandon setup, and it breaks CI unless the binary is committed.
3. Fetch at prebuild from a manifest.

An npm install flag (`--model=lite`) was also considered and rejected: it breaks with `npm ci`,
yarn/pnpm/bun, `--ignore-scripts`, and the shared npm cache — and it cannot remove a *native*
dependency, since the podspec is already on disk by the time scripts run.

## Decision

Ship a manifest of URLs and SHA-256 checksums. The config plugin (or CLI, for bare RN) fetches
the selected variant at prebuild, verifies it, caches it, and installs exactly one into both
native projects.

## Consequences

- npm tarball drops from ~9.5 MB to ~60 KB.
- Variant choice is one word in `app.json`. Apps can ship `lite` at ~19.7 MB installed instead
  of being locked to `full`.
- No binary in git history.
- Requires network at first prebuild. Cached afterwards; a cache miss offline fails with an
  actionable message rather than silently.
- Checksum mismatch is a hard failure, never a warning.
- The plugin must remove the previously installed model on variant change, or builds accumulate
  models.
