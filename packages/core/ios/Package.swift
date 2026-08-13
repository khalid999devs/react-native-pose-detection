// swift-tools-version: 5.9
import PackageDescription

/**
 A test harness, not a distribution channel. The package this repository ships is the podspec
 beside this file; consumers never see this manifest, and `files` in package.json leaves it out
 of the tarball.

 It exists so the platform-independent half of the iOS source has a suite that runs anywhere Swift
 does, with no simulator, no Xcode project and no MediaPipe. That half is exactly the half Android
 covers with JUnit: the engine, the wire format, and the performance resolver. Everything touching
 AVFoundation, MediaPipe or ExpoModulesCore is compiled by the pod and is not listed here.
 */
let package = Package(
  name: "PoseEngine",
  platforms: [.macOS(.v12)],
  targets: [
    .target(
      name: "PoseEngine",
      path: ".",
      exclude: [
        "Tests",
        // `view` and `export` are listed file by file rather than as directories so that
        // OverlayProjection and ExportCanvas can be compiled in: where the picture lands and how
        // big the output is are exactly the kind of arithmetic that deserves tests, and the rest
        // of both directories needs UIKit, AVFoundation or MediaPipe.
        "view/OverlayParsing.swift",
        "view/OverlayView.swift",
        "view/OverlayRenderer.swift",
        "view/OverlayRenderer+Angles.swift",
        "view/PoseCameraView.swift",
        "view/PoseCameraView+Capture.swift",
        "view/PoseCameraView+Delivery.swift",
        "view/PoseCameraView+Frames.swift",
        "view/PoseCameraView+Lifecycle.swift",
        "view/PoseCameraView+Props.swift",
        "view/PoseCameraView+Ref.swift",
        "view/PoseCameraView+Session.swift",
        "camera",
        "detector",
        "export/ExportOptions.swift",
        "export/PoseExport.swift",
        "export/VideoExporter.swift",
        "export/VideoExporter+Encode.swift",
        "PoseDetectionModule.swift",
        "Permissions.swift",
        "ReactNativePoseDetection.podspec"
      ],
      sources: [
        "Monotonic.swift",
        "CancelRegistry.swift",
        "Guarded.swift",
        "ErrorCode.swift",
        "Skeleton.swift",
        "PoseLog.swift",
        "JSCoercion.swift",
        "engine",
        "performance",
        "view/OverlayProjection.swift",
        "export/ExportCanvas.swift"
      ]
    ),
    .testTarget(
      name: "PoseEngineTests",
      dependencies: ["PoseEngine"],
      path: "Tests/PoseEngineTests"
    )
  ]
)
