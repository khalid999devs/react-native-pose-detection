import AVFoundation
import CoreMedia

/**
 The asset reads that iOS 16 replaced with async ones, in the only place they are allowed to live.

 `duration`, `tracks(withMediaType:)`, `preferredTransform`, `naturalSize`, `formatDescriptions` and
 `AVAssetImageGenerator.copyCGImage` all became `load(_:)` and `image(at:)` in iOS 16. None of the
 replacements exist on 15.1, which is the floor React Native 0.74 sets and this package's
 `peerDependencies` inherit, so the old calls are still the ones that run.

 Every one of them warns, and that is the point of this file: the warnings are the cost of the
 support floor rather than an oversight, so they are gathered here where one comment explains all of
 them instead of appearing wherever a frame or a track happens to be read. Raising the floor to 16
 is what removes them, and that is a compatibility decision rather than a cleanup.

 Marking these `@available(iOS, deprecated: 16.0)` would move each warning to its call site rather
 than remove it, so the annotation is left off and the reason written down. See
 docs/native-modules.md.
 */
enum AssetCompat {
  static func durationSeconds(_ asset: AVAsset) -> Double {
    return CMTimeGetSeconds(asset.duration)
  }

  static func tracks(_ asset: AVAsset, of type: AVMediaType) -> [AVAssetTrack] {
    return asset.tracks(withMediaType: type)
  }

  static func preferredTransform(_ track: AVAssetTrack) -> CGAffineTransform {
    return track.preferredTransform
  }

  static func naturalSize(_ track: AVAssetTrack) -> CGSize {
    return track.naturalSize
  }

  /// The array is `[Any]`, so it is cast whole: a conditional downcast of one CoreFoundation value
  /// is a compile error because it can never fail.
  static func formatDescription(_ track: AVAssetTrack) -> CMFormatDescription? {
    return (track.formatDescriptions as? [CMFormatDescription])?.first
  }

  static func copyFrame(from generator: AVAssetImageGenerator, at time: CMTime) -> CGImage? {
    return try? generator.copyCGImage(at: time, actualTime: nil)
  }
}
