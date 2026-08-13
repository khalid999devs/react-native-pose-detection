import Foundation

/**
 Everything a condition can read about one frame. Reused across frames and mutated in place: this
 is on the inference path, and a per-frame allocation here is a per-frame allocation everywhere.
 */
final class FrameContext {
  var landmarks: [Float] = []
  var previousLandmarks: [Float]?

  /// `NaN` when there is no comparable previous frame, which makes every velocity unknown.
  var elapsedSeconds = Float.nan

  var comX = Float.nan
  var comY = Float.nan
  var comVelocityX = Float.nan
  var comVelocityY = Float.nan

  var frameWidth = 0
  var frameHeight = 0

  func axis(_ joint: Int, _ axis: Int) -> Float {
    return landmarks[joint * Skeleton.landmarkStride + axis]
  }

  /**
   Normalized units per second, uncorrected for aspect, so it is in the same units as the
   positions a threshold is written against. `NaN` when there is nothing to differ from.
   */
  func velocity(_ joint: Int, _ axis: Int) -> Float {
    guard let previous = previousLandmarks else { return .nan }
    if elapsedSeconds.isNaN || elapsedSeconds <= 0 { return .nan }

    let offset = joint * Skeleton.landmarkStride + axis
    return (landmarks[offset] - previous[offset]) / elapsedSeconds
  }
}

/**
 A parsed `Condition`. JavaScript validates the shape before native ever sees it, so this half is
 about evaluating quickly rather than about diagnosing: a config that fails to parse here is
 logged and treated as one that never matches.
 */
protocol PoseCondition {
  func matches(_ frame: FrameContext) -> Bool
}

let noJoint = -1
let axisX = 0
let axisY = 1

/**
 `NaN` is how an absent bound is stored, and it is also what an unmeasurable value is. Both mean
 the same thing here: a comparison against `NaN` is false, so a condition over a value nobody could
 measure does not match, and a bound nobody set does not constrain.
 */
func withinBounds(
  _ value: Float,
  below: Float,
  above: Float,
  betweenMin: Float,
  betweenMax: Float
) -> Bool {
  if value.isNaN { return false }
  if !below.isNaN && value >= below { return false }
  if !above.isNaN && value <= above { return false }
  // Inclusive, unlike below and above, because `between` names the range you want to be in.
  if !betweenMin.isNaN && (value < betweenMin || value > betweenMax) { return false }
  return true
}

struct AngleCondition: PoseCondition {
  let proximal: Int
  let vertex: Int
  let distal: Int
  let below: Float
  let above: Float
  let betweenMin: Float
  let betweenMax: Float

  func matches(_ frame: FrameContext) -> Bool {
    let value = Geometry.angleDegrees(
      frame.landmarks,
      proximal: proximal,
      vertex: vertex,
      distal: distal,
      frameWidth: frame.frameWidth,
      frameHeight: frame.frameHeight
    )
    return withinBounds(value, below: below, above: above, betweenMin: betweenMin, betweenMax: betweenMax)
  }
}

/**
 A bound that names a joint is compared against that joint in the same frame, which is what keeps
 "wrist above shoulder" true at any distance from the camera.
 */
struct LandmarkCondition: PoseCondition {
  let axis: Int
  let joint: Int
  let below: Float
  let belowJoint: Int
  let above: Float
  let aboveJoint: Int

  func matches(_ frame: FrameContext) -> Bool {
    let value = frame.axis(joint, axis)
    let resolvedBelow = belowJoint == noJoint ? below : frame.axis(belowJoint, axis)
    let resolvedAbove = aboveJoint == noJoint ? above : frame.axis(aboveJoint, axis)
    return withinBounds(value, below: resolvedBelow, above: resolvedAbove, betweenMin: .nan, betweenMax: .nan)
  }
}

struct VelocityCondition: PoseCondition {
  let axis: Int
  /// `noJoint` is `centerOfMass`, whose velocity is already computed for the wire.
  let joint: Int
  let below: Float
  let above: Float

  func matches(_ frame: FrameContext) -> Bool {
    let value: Float
    if joint != noJoint {
      value = frame.velocity(joint, axis)
    } else if axis == axisX {
      value = frame.comVelocityX
    } else {
      value = frame.comVelocityY
    }
    return withinBounds(value, below: below, above: above, betweenMin: .nan, betweenMax: .nan)
  }
}

struct VisibilityCondition: PoseCondition {
  let joint: Int
  let above: Float

  func matches(_ frame: FrameContext) -> Bool {
    return Geometry.visibility(frame.landmarks, joint: joint) > above
  }
}

struct AllCondition: PoseCondition {
  let members: [any PoseCondition]

  func matches(_ frame: FrameContext) -> Bool {
    for member in members where !member.matches(frame) { return false }
    return true
  }
}

struct AnyCondition: PoseCondition {
  let members: [any PoseCondition]

  func matches(_ frame: FrameContext) -> Bool {
    for member in members where member.matches(frame) { return true }
    return false
  }
}

/// What an unparseable condition becomes. Never matching beats matching for the wrong reason.
struct NeverCondition: PoseCondition {
  func matches(_ frame: FrameContext) -> Bool { return false }
}

/// The negation of `enter`, which is what returns a trigger with no `exit` to idle.
struct NotCondition: PoseCondition {
  let inner: any PoseCondition

  func matches(_ frame: FrameContext) -> Bool {
    return !inner.matches(frame)
  }
}
