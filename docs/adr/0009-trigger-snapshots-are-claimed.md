# 0009: Trigger snapshots are claimed, not carried

**Status:** accepted
**Date:** 2026-08-12

## Context

[ADR 0008](./0008-frames-are-drained-not-pushed.md) established that an Expo Modules event cannot
carry an ArrayBuffer, and moved frame delivery to a drain over the function-return path. It moved
`onPose` and `onPoseBatch`. It missed one.

`TriggerEvent.snapshot` is a `PoseFrame`, and `onTrigger` is an event. A trigger declared with
`snapshot: true` was specified to arrive with the frame that fired it attached. That frame's
landmarks are a `Float32Array`, so it hits exactly the wall 0008 documented: `JSTypeConverter`
would turn it into a `ReadableArray` of boxed doubles, or drop it.

The trigger event's other fields are all scalars and cross fine. Only the frame is a problem, and
only when the trigger asked for one, which most do not.

## Decision

Native holds the captured frame and puts a claim ticket on the event instead of the frame.

`NativeTriggerEvent` is the public `TriggerEvent` minus `snapshot`, plus an optional
`snapshotId: number`. When `<PoseCamera>` sees a ticket it calls `takeTriggerSnapshot(id)`, which
returns the frame in the same self-describing buffer `drainFrames()` uses, decodes it, attaches it,
and only then calls `onTrigger`. Redeeming a ticket releases the frame native was holding.

A trigger without `snapshot: true` carries no ticket and its event is delivered synchronously, on
the same tick it arrives. Nothing about the common case changes.

## Consequences

- A `snapshot: true` trigger is delivered one microtask later than a plain one. Triggers are
  already an event on a background pipeline, so ordering against the app's own state was never
  synchronous, but two triggers firing in the same frame where only one has a snapshot can now be
  delivered out of order. Firing order is preserved within each kind, not across them.
- Redeeming an unknown or already-redeemed ticket returns an empty buffer rather than failing.
  A snapshot is diagnostic, so losing one must never take the trigger with it: if the fetch fails
  for any reason the event is still delivered, with `snapshot` absent.
- Native has to bound how many unclaimed frames it holds, and drop the oldest. A JavaScript
  listener that throws before redeeming must not be able to pin frames forever.
- The snapshot is shaped by `data.select` like every other frame, so a narrowed buffer narrows the
  snapshot too. Reading a joint that `select` left out throws from the accessor, which is the
  documented behavior of a narrowed frame rather than a special case for triggers.
- This is the second consequence of the same root cause. The custom JSI binding 0008 defers to
  0.2.0 would remove both the drain tick and this ticket, since a host object can hand JavaScript
  an ArrayBuffer from anywhere.
