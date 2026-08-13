# Changelog

Notable changes, written for humans. Follows [Keep a Changelog](https://keepachangelog.com/)
and [Semantic Versioning](https://semver.org/).

## [Unreleased]

Nothing has been published yet. The version in `package.json` is `0.0.0` and stays there until
`0.1.0` ships, so everything below is work in progress rather than a release anyone can install.
The camera and the export path have run on an Android emulator and an iOS simulator; nothing here
has run on a physical device or a real camera sensor.

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
- The engine, on both platforms: geometry with the aspect correction, the One-Euro smoother, the
  condition and trigger evaluators, the wire encoder and its bounded ring buffer, and the
  performance resolver with calibration and the thermal ladder
- iOS: the podspec, `CameraSource` on AVFoundation, `PoseDetector` with the GPU probe,
  `OverlayView`, static image and video input, and the module definition. Written and
  type-checked against the iOS SDK, never run on a device
- Native unit tests on both platforms: 65 under JUnit, 69 under XCTest, over the same behavior
- Frame delivery on the JavaScript side: the self-describing wire format, `decodeFrames`, the
  drain loop, and `onFramesDropped` for frames the native ring buffer had to drop
- `npm test`: 73 tests on Node's built-in runner, no test framework dependency, covering the wire
  format, the accessors, trigger validation and the joint tables, plus two parity suites that read
  the Kotlin, the Swift and the reference guides and fail when any of them drifts from the types
- The Expo example app in full: twelve screens including a playground that shows every prop's
  requested value next to what it resolved to, a live trigger editor, the four data modes with
  their measured crossing rates, the recipes from the guides running as written, the log stream
  with per-category levels, and a scenario panel that drives the camera-switch, remount, toggle
  and soak runs a device test needs
- The four CI build cells: `android-expo`, `android-bare`, `ios-expo` and `ios-bare`, the last of
  those built Release so the linker's dead-stripping runs and the module is asserted to survive it
- `exportPose`: paints the skeleton into a copy of a picked photo or clip and writes it into a
  directory the app owns, through its own CPU detector on a queue below the camera's, so an export
  running beside a live preview costs the preview nothing but shared CPU. iOS goes through
  `AVAssetReader`/`AVAssetWriter`; Android decodes to a `SurfaceTexture`, composites in GL and
  muxes with `MediaMuxer`, carrying the audio track through untouched on both
- `minConfidence` on `<PoseCamera>` and on `exportPose`. Left out it follows `maxPoses`, because the
  two are one decision: a single subject is detected at a bar high enough to keep scenery out, and
  asking for more than one lowers it to the point where a second person is actually returned rather
  than the first person twice

### Fixed

- World landmarks were read from `worldLandmarks[0]` while every other value in the frame described
  the largest body, so with `maxPoses` above one a single frame could pair one person's screen
  coordinates with another person's metric ones. Both platforms
- The export painted only the first pose however high `maxPoses` was set. Every pose the model
  returns is now painted, on both platforms
- `maxPoses` above one had no effect in practice, because the confidence it was paired with was
  tuned for a single subject and the model returned one body whatever the ceiling said
- Neither iOS export loop drained an autorelease pool per frame, so a long clip held every decoded
  frame and every `MPImage` until the whole export finished, which is the memory-pressure kill the
  export's own bounded-memory rule exists to prevent
- The iOS export waited on `isReadyForMoreMediaData` without a bound. That flag stops turning true
  once the writer fails, so a disk filling mid-export left the export queue spinning for the life
  of the process. Both wait loops now check the writer's status and the cancel flag

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
