# Logging

A diagnostic channel that costs nothing when it's off and streams live when it's on.

## Contract

**Disabled is the default and must be free.** The only cost when logging is off is one
atomic integer compare per call site. No string is built, no object is allocated, nothing
crosses to JavaScript.

That constraint drives the whole design: **log calls take a closure, never a built string.**

```kotlin
// Kotlin: inline + lambda: when disabled the lambda is never invoked and
// inlining erases the allocation entirely
log(DEBUG, CAMERA) { "switch complete in ${elapsed}ms, gen=$generation" }
```

```swift
// Swift: @autoclosure defers evaluation to the same effect
log(.debug, .camera, "switch complete in \(elapsed)ms, gen=\(generation)")
```

```kotlin
// WRONG: builds the string whether or not logging is on
log(DEBUG, CAMERA, "switch complete in ${elapsed}ms")
```

A PR that formats a string outside the closure will not be merged. It's the one mistake that
silently turns a free feature into a per-frame cost.

## Levels and categories

| Level | Use for |
| --- | --- |
| `off` *(default)* | production |
| `error` | something failed and the user should know |
| `warn` | degraded but running: GPU fallback, dropped frames |
| `info` | lifecycle: camera opened, model loaded, calibration settled |
| `debug` | state transitions: switch phases, trigger phases, thermal steps |
| `trace` | per-frame: timings, landmark counts. **Expect volume.** |

| Category | Emitted by |
| --- | --- |
| `camera` | capture, lifecycle, switching |
| `detector` | landmarker init, delegate selection, inference errors |
| `engine` | geometry, smoothing, emission decisions |
| `triggers` | condition evaluation, phase changes, debounce suppression |
| `calibration` | probe results, convergence steps, cache hits |
| `overlay` | draw path, layer lifecycle |
| `plugin` | model fetch, checksum, install (build time, not runtime) |

Levels are set per category, so `trace` on `triggers` doesn't drown you in `camera` output.

## Delivery

Log entries are **batched**, not emitted per line. Streaming a `trace`-level log one entry at
a time would recreate exactly the bridge problem this library exists to avoid.

```text
native ring buffer (bounded, drop-oldest + count)
  → flush every 250 ms, or when the buffer is half full
  → single event carrying an array
```

The buffer is bounded. If a JS consumer stalls, the oldest entries are dropped and a
`droppedCount` is reported rather than letting memory grow.

Entries are also written to the platform console (`os_log` / `Logcat`) when the level is
enabled, so native-only debugging works without a JS listener attached.

## Implementation notes

- The level mask is a single atomic int: 3 bits of level × 7 categories. One compare per call site.
- Changing the level is a write to that int, no re-initialization, safe at any time.
- Timestamps come from the same monotonic clock as `PoseFrame.timestamp`, so logs and frames
  can be correlated.
- `plugin` logs come from Node at build time and never reach the runtime channel.
- Logging must never change behavior. If a bug disappears at `trace`, the log calls are doing
  work, that's the bug.

## Testing

- Assert zero allocations in the frame path with logging `off` **and** at `error`, level checks
  must not allocate at any disabled level
- Assert bounded memory under sustained `trace` with no listener attached
- Assert `droppedCount` is reported rather than the buffer growing

User-facing documentation: [guides/debugging.md](../guides/debugging.md).
