# 0001 — Own camera, not VisionCamera

**Status:** accepted
**Date:** 2026-08-12

## Context

`react-native-vision-camera` is the de-facto standard camera in React Native and provides frame
processors. Building on it would save writing AVFoundation and CameraX integration, and would
give worklet support essentially for free.

The alternative is owning the camera directly, which means writing and maintaining capture,
orientation, lifecycle, and permissions on both platforms.

## Decision

Ship our own camera as the primary entry point. Add a VisionCamera frame-processor adapter in
0.2.0 as an *additional* entry point, not a replacement.

## Consequences

- **Zero peer dependencies** — `npm i` and a plugin line is the whole setup. The leading
  competitor requires installing and configuring VisionCamera *and* supplying a model file.
- We own CameraX. Frame orientation across device rotation and camera switching is the largest
  source of Android bugs in this package.
- Apps that already use VisionCamera cannot adopt us until 0.2.0 — two capture sessions on one
  device is not viable.
- Worklets are deferred to 0.2.0, since the mechanism for invoking JS on a frame thread comes
  with the VisionCamera adapter.
- **`PoseEngine` must never import camera code.** The frame source is an input. This is what
  keeps the 0.2.0 adapter a ~200-line addition rather than a fork.
