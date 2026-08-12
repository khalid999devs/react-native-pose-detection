# 0006: A checksum mismatch is fatal, except in the cache

**Status:** accepted
**Date:** 2026-08-12

## Context

[ADR 0002](./0002-models-fetched-not-bundled.md) makes the SHA-256 check a hard build failure
rather than a warning. Implementing it turned up a case that rule does not obviously cover.

There are two places a model file gets verified, and they are not the same event:

1. **A file that just came off the network.** A mismatch here means the bytes were corrupted or
   intercepted in transit. There is no benign reading of it.
2. **A file already sitting in `~/.cache/react-native-pose-detection`.** A mismatch here usually
   means a full disk, an interrupted copy, or a machine that lost power mid-write. The cache is
   a local convenience, not a trust boundary. Nothing about a damaged cache file says anything
   about the CDN.

Treating the second case as fatal means a developer with a truncated cache file gets a build
that fails until they know `clear-cache` exists. Treating the first case as recoverable means
the whole point of the checksum is gone.

## Decision

A mismatch on a **downloaded** file is fatal. The `.part` file is deleted, nothing is installed,
and the error names both hashes and the URL.

A mismatch on a **cached** file deletes the cache entry and downloads again. That fresh download
is then subject to the fatal rule. Prebuild prints a warning line so it is visible rather than
silent.

The distinction is that a bad download is never accepted, in either path. Re-downloading a
damaged cache entry is not tolerating a mismatch, it is refusing to use the damaged file.

Verification runs on every prebuild, including cache hits. Hashing 9 MB costs a few milliseconds
against a build measured in seconds, and skipping it would mean a file damaged after its first
successful verification is used forever.

## Consequences

- A corrupted cache self-heals on the next prebuild and costs one download.
- A tampered or corrupted download stops the build every time, with no path that quietly
  proceeds.
- One extra download in the case where the CDN itself is serving bad bytes: we retry once before
  failing. That is bounded, and the failure still happens.
- `clear-cache` stays a convenience rather than a recovery step people are expected to discover
  from an error message.
- Size alone is never enough. A file truncated to exactly the right length by a full disk passes
  a size check and fails at model load, natively, at runtime. Both checks run, size first because
  it is free.
