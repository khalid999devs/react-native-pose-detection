import Foundation

/// Pure functions over the flat landmark buffer. No allocation, no state, no camera.
enum Geometry {
  private static let epsilon: Float = 1e-6
  private static let degreesPerRadian = Float(180.0 / Double.pi)

  /**
   The angle at `vertex`, in degrees, 0 to 180.

   MediaPipe divides x by width and y by height, so on a non-square frame the normalized space is
   anisotropic and an angle read straight off it is wrong by tens of degrees. The frame size is
   what puts both axes back in a common unit.

   `Float.nan` when the triangle is degenerate: 0 would be indistinguishable from a folded joint.
   */
  static func angleDegrees(
    _ landmarks: [Float],
    proximal: Int,
    vertex: Int,
    distal: Int,
    frameWidth: Int,
    frameHeight: Int
  ) -> Float {
    guard frameWidth > 0, frameHeight > 0 else { return .nan }
    let aspect = Float(frameWidth) / Float(frameHeight)

    let vx = landmarks[vertex * Skeleton.landmarkStride]
    let vy = landmarks[vertex * Skeleton.landmarkStride + 1]

    let ax = (landmarks[proximal * Skeleton.landmarkStride] - vx) * aspect
    let ay = landmarks[proximal * Skeleton.landmarkStride + 1] - vy
    let bx = (landmarks[distal * Skeleton.landmarkStride] - vx) * aspect
    let by = landmarks[distal * Skeleton.landmarkStride + 1] - vy

    let magnitude = ((ax * ax + ay * ay) * (bx * bx + by * by)).squareRoot()
    if magnitude < epsilon { return .nan }

    // Floating point can push this a hair outside [-1, 1], where acos returns NaN.
    let cosine = min(max((ax * bx + ay * by) / magnitude, -1), 1)
    return acos(cosine) * degreesPerRadian
  }

  /**
   Direction of the angle's bisector, for placing the arc and its label. Takes projected screen
   pixels: a direction taken before projection lands outside the joint on a mirrored preview.
   */
  static func bisectorRadians(
    proximalX: Float,
    proximalY: Float,
    vertexX: Float,
    vertexY: Float,
    distalX: Float,
    distalY: Float
  ) -> Float {
    let ax = proximalX - vertexX
    let ay = proximalY - vertexY
    let bx = distalX - vertexX
    let by = distalY - vertexY

    let aLength = (ax * ax + ay * ay).squareRoot()
    let bLength = (bx * bx + by * by).squareRoot()
    if aLength < epsilon || bLength < epsilon { return .nan }

    let sumX = ax / aLength + bx / bLength
    let sumY = ay / aLength + by / bLength
    if abs(sumX) < epsilon && abs(sumY) < epsilon { return .nan }

    return atan2(sumY, sumX)
  }

  static func visibility(_ landmarks: [Float], joint: Int) -> Float {
    return landmarks[joint * Skeleton.landmarkStride + Skeleton.offsetVisibility]
  }

  /**
   Visibility-weighted center of mass, written to `out[offset]` and `out[offset + 1]`.

   Hip 0.5, ankle 0.3, knee 0.2, each side carrying half of its pair's weight and scaled by its
   own visibility, so one occluded leg shifts the result toward the leg that is actually visible
   rather than toward the midpoint of a guess. `NaN` when nothing is visible enough to weigh: a
   fallback would be a position the body is not in.

   Normalized frame coordinates, uncorrected. It is compared against other normalized positions,
   which are anisotropic in the same way, and correcting one side of that comparison is what would
   make it wrong.
   */
  static func centerOfMass(_ landmarks: [Float], into out: inout [Float], at offset: Int) {
    var sumX: Float = 0
    var sumY: Float = 0
    var total: Float = 0

    for index in comJoints.indices {
      let base = comJoints[index] * Skeleton.landmarkStride
      let weight = comWeights[index] * landmarks[base + Skeleton.offsetVisibility]
      if weight <= 0 { continue }
      sumX += landmarks[base] * weight
      sumY += landmarks[base + 1] * weight
      total += weight
    }

    if total < epsilon {
      out[offset] = .nan
      out[offset + 1] = .nan
      return
    }
    out[offset] = sumX / total
    out[offset + 1] = sumY / total
  }

  /**
   Shoulder midpoint to ankle midpoint, in normalized units and uncorrected for the same reason as
   `centerOfMass`: it exists to be divided into other normalized distances.
   */
  static func bodySpan(_ landmarks: [Float]) -> Float {
    let shoulderX = midpoint(landmarks, Skeleton.leftShoulder, Skeleton.rightShoulder, axis: 0)
    let shoulderY = midpoint(landmarks, Skeleton.leftShoulder, Skeleton.rightShoulder, axis: 1)
    let ankleX = midpoint(landmarks, Skeleton.leftAnkle, Skeleton.rightAnkle, axis: 0)
    let ankleY = midpoint(landmarks, Skeleton.leftAnkle, Skeleton.rightAnkle, axis: 1)

    let dx = shoulderX - ankleX
    let dy = shoulderY - ankleY
    return (dx * dx + dy * dy).squareRoot()
  }

  private static func midpoint(_ landmarks: [Float], _ left: Int, _ right: Int, axis: Int) -> Float {
    let lhs = landmarks[left * Skeleton.landmarkStride + axis]
    let rhs = landmarks[right * Skeleton.landmarkStride + axis]
    return (lhs + rhs) / 2
  }

  private static let comJoints = [
    Skeleton.leftHip, Skeleton.rightHip,
    Skeleton.leftKnee, Skeleton.rightKnee,
    Skeleton.leftAnkle, Skeleton.rightAnkle
  ]

  private static let comWeights: [Float] = [0.25, 0.25, 0.1, 0.1, 0.15, 0.15]
}
