# Changelog

All notable changes to this package are documented here. Versions follow
[semantic versioning](https://semver.org), and every published version is an annotated `v*` tag
on the commit that was published.

## 0.1.0

The first release.

- `<PoseCamera />`: live camera with 33-landmark detection and a native skeleton overlay, on
  CameraX and AVFoundation, MediaPipe Tasks Vision 0.10.35 on both platforms
- Self-tuning performance governor: measures inference cost, converges on the fastest
  sustainable frame rate, steps down with heat, caches the settled answer per device and model
- Native trigger engine: declarative conditions evaluated on the camera thread, one event per
  firing, with optional frame snapshots
- Data delivery: `off`, `throttled`, `batched` and `live` modes over one zero-copy binary
  buffer
- Static input: `detectOnImage` and `detectOnVideo` for files, no camera required
- `exportPose`: full-quality painted copies of photos and videos, cancellable, crash-safe
  staging, without slowing a live camera down
- One-Euro smoothing, angle overlays, camera switching, thermal ladder, GPU-to-CPU fallback
- Config plugin and CLI that download, verify and install the model at build time
