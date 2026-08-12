# Changelog

Notable changes, written for humans. Follows [Keep a Changelog](https://keepachangelog.com/)
and [Semantic Versioning](https://semver.org/).

## [Unreleased]

Nothing has been published yet. The version in `package.json` is `0.0.0` and stays there until
`0.1.0` ships, so everything below is work in progress rather than a release anyone can install.
The engine that evaluates triggers, computes geometry and calibrates is not written, and neither
is iOS.

### Added
- Repository scaffold, tooling, and quality gates
- Public TypeScript API: `PoseCamera`, the prop and event types, the 33-joint and 12-angle-joint
  tables, the 35-pair skeleton, error codes, and the zero-copy landmark accessors
- Trigger configuration validation that runs during render, so a bad config fails at the call
  site with a path rather than reaching native as a trigger that never fires
- Config plugin and CLI: model fetch with checksum verification, cache, install into both native
  projects, and removal of the previous variant on a switch
- Android camera, detector and native overlay, including angle arcs. Written and building, never
  run on a device
- Frame delivery on the JavaScript side: the self-describing wire format, `decodeFrames`, the
  drain loop, and `onFramesDropped` for frames the native ring buffer had to drop
- `npm test`: 60 tests on Node's built-in runner, no test framework dependency, covering the wire
  format, the accessors, trigger validation and the joint tables

### Notes for anyone tracking this before 0.1.0

- Frames are pulled rather than pushed, which costs two bridge crossings per emission instead of
  one. See [ADR 0008](docs/adr/0008-frames-are-drained-not-pushed.md)
- A `snapshot: true` trigger is delivered one microtask later than a plain one, because the frame
  is claimed with a ticket instead of riding the event. See
  [ADR 0009](docs/adr/0009-trigger-snapshots-are-claimed.md)
- `data.select` narrows the landmark buffer to exactly the joints named and never widens it to
  serve an angle. Reading a joint it left out throws
- `setProfile()` and `getProfile()` throw until calibration lands
- MediaPipe is pinned to 0.10.35 on Android. See
  [ADR 0007](docs/adr/0007-pin-mediapipe-0-10-35.md), which supersedes ADR 0003
