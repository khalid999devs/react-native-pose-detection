# 0005: `select` narrows the landmark buffer

**Status:** accepted
**Date:** 2026-08-12

## Context

The wire format is 33 landmarks of 4 floats each, 528 bytes per frame. `data.select` lets a
consumer ask for a few joints instead of all of them, and most do: a rep counter needs three.

That leaves two ways to honor it, and they are hard to swap later because both native encoders
and every accessor depend on the answer.

**Zero-fill.** Always send 132 floats, write zeros where the joint was not selected. A joint's
position is `JOINT_INDEX[name] * 4`, always, so the accessor is one multiply and the native
encoder never branches.

**Narrow.** Send only the selected joints, in the order they were listed. Three joints is 12
floats, 48 bytes.

Zero-fill is simpler. It is also 11x the bytes for the common case, and it makes an unselected
joint indistinguishable from a joint at the origin with zero visibility, which is a real pose
the model can produce when tracking fails.

## Decision

Narrow. `PoseFrame.landmarks` carries `selection.length * LANDMARK_STRIDE` floats, and
`PoseFrame.selection` lists the joints in buffer order. `selection` is absent when no `select`
was set, which is the full-frame case.

The accessors resolve the position, so `landmark(frame, 'leftKnee')` reads the same either way
and consumer code does not change when a joint is added to or removed from `select`.

Reading a joint that was not selected throws `PoseConfigError`. A zero would be wrong, and
`null` would push a check into every call site to catch a mistake that is fixed once in a config
object.

`selection` is the same frozen array instance on every frame of a session. Native holds it,
never rebuilds it, and the accessors cache their name-to-position map against that identity in
a `WeakMap`, so lookup stays O(1) without adding a per-frame allocation.

## Consequences

- Payload scales with what you asked for, which is what makes `select` worth using at all.
- Absent and zero are distinguishable. `hasLandmark()` answers the first, `visibilityOf()` the
  second.
- Both native encoders carry a small amount of extra bookkeeping: the resolved index list, built
  once at mount when `select` is applied, not per frame.
- Direct indexing into `frame.landmarks` by `JOINT_INDEX` is wrong under `select`. That is why
  the accessors are the documented path and the raw layout is documented second.
- Reversing this later would change the meaning of an existing buffer, so it would be a major
  version, not a patch.
