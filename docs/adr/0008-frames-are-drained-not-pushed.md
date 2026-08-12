# 0008: Frames are drained, not pushed

**Status:** accepted
**Date:** 2026-08-12

## Context

[ADR 0005](./0005-select-narrows-the-buffer.md) and the whole wire format assume landmarks cross
as a `Float32Array` over an ArrayBuffer. Phase 1 typed it, Phase 3 built the native side, and
Phase 4 went to connect them and found the assumption was wrong in one specific place.

Expo Modules has two paths to JavaScript, and they are not equivalent:

| Path | Conversion | Carries an ArrayBuffer |
| --- | --- | --- |
| Function return | `JNIToJSIConverter<NativeArrayBuffer *>` → `jsi::ArrayBuffer` | **yes**, zero copy |
| Event | `JSTypeConverter` → `WritableMap` | **no** |

`JSTypeConverter` handles `String`, `Int`, `Long`, `Number`, `Boolean`, `ReadableArray`, and
`ReadableMap`. Nothing else. A `FloatArray` put on an event becomes a `ReadableArray` of 132
boxed doubles, which is the roughly 3 KB JSON-shaped payload the Float32Array design exists to
avoid.

So the format works. It just cannot ride an event, and `onPose` and `onPoseBatch` were specified
as events.

Three ways out were considered. Boxing the array on the event was rejected outright: it makes the
wire format, the accessors, and ADR 0005 decoration. Writing a custom JSI host object would keep
the documented crossing counts exactly, but it means our own C++ and JNI layer working across old
and new architecture on two platforms, and it is the part of the package least testable without a
device. That is a reasonable thing to want eventually, and it is the same machinery 0.2.0 needs
for worklets, but it is not a reasonable thing to depend on now.

## Decision

Native buffers frames and emits a tick carrying no landmarks. JavaScript answers the tick by
calling `drainFrames()`, which returns everything buffered since the last call in one ArrayBuffer.

**The buffer describes itself.** A header carries the frame count, the dropped count, the floats
per frame, the joint count, and a flag word, followed by per-frame `Float64` timestamps and then
the `Float32` body. Nothing about the layout is agreed out of band, so a drain that races ahead
of its tick, or arrives after two ticks, still decodes correctly. Timestamps are `Float64`
because a `Float32` mantissa runs out after about 4.6 hours of uptime and the clock is monotonic
since boot.

Frames come out as `subarray` views into that buffer. No copy, no parse.

The cost is one extra crossing per **emission**, not per frame:

| Mode | Documented | Actual |
| --- | --- | --- |
| `off` | 0 | 0 |
| `batched` | 2/sec | 4/sec |
| `throttled` | 10/sec | 20/sec |
| `live` | 30/sec | 60/sec |

Triggers are unaffected. They carry scalars, and a `snapshot: true` trigger pays one drain for
the frame it attaches.

## Consequences

- The guides now state the real numbers. `batched` is still 15 times cheaper than `live`, which
  is the comparison that actually drives the advice.
- `PoseCameraRef.snapshot()` becomes `Promise<PoseFrame | null>`. It needs the same
  function-return path, so it cannot be synchronous. `getState()` stays synchronous, mirrored in
  JavaScript from the events that already carry it.
- The extra crossing is a JSI call, not a bridge round trip, and in `batched` mode it returns
  every buffered frame at once regardless of how many there are.
- A custom JSI binding stays available later and would remove the tick entirely. Worth doing
  when 0.2.0 brings worklets and the same native plumbing is needed anyway, not before.
- Nothing about the format changed. `LANDMARK_STRIDE`, the 33 by 4 layout, the accessors, and
  ADR 0005 are all untouched. Only the delivery moved.
