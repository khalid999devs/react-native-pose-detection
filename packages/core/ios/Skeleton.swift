import Foundation

/**
 BlazePose landmark order, the skeleton, and the joints that have an angle. These three tables
 are the contract from `src/types/joints.ts`, and Android carries the same three. Any divergence
 is a bug even when each side looks right alone.
 */
enum Skeleton {
  static let landmarkCount = 33
  static let landmarkStride = 4

  static let offsetX = 0
  static let offsetY = 1
  static let offsetZ = 2
  static let offsetVisibility = 3

  static let nose = 0
  static let leftEyeInner = 1
  static let leftEye = 2
  static let leftEyeOuter = 3
  static let rightEyeInner = 4
  static let rightEye = 5
  static let rightEyeOuter = 6
  static let leftEar = 7
  static let rightEar = 8
  static let mouthLeft = 9
  static let mouthRight = 10
  static let leftShoulder = 11
  static let rightShoulder = 12
  static let leftElbow = 13
  static let rightElbow = 14
  static let leftWrist = 15
  static let rightWrist = 16
  static let leftPinky = 17
  static let rightPinky = 18
  static let leftIndex = 19
  static let rightIndex = 20
  static let leftThumb = 21
  static let rightThumb = 22
  static let leftHip = 23
  static let rightHip = 24
  static let leftKnee = 25
  static let rightKnee = 26
  static let leftAnkle = 27
  static let rightAnkle = 28
  static let leftHeel = 29
  static let rightHeel = 30
  static let leftFootIndex = 31
  static let rightFootIndex = 32

  static let jointNames = [
    "nose", "leftEyeInner", "leftEye", "leftEyeOuter",
    "rightEyeInner", "rightEye", "rightEyeOuter",
    "leftEar", "rightEar", "mouthLeft", "mouthRight",
    "leftShoulder", "rightShoulder", "leftElbow", "rightElbow",
    "leftWrist", "rightWrist", "leftPinky", "rightPinky",
    "leftIndex", "rightIndex", "leftThumb", "rightThumb",
    "leftHip", "rightHip", "leftKnee", "rightKnee",
    "leftAnkle", "rightAnkle", "leftHeel", "rightHeel",
    "leftFootIndex", "rightFootIndex"
  ]

  private static let nameToIndex: [String: Int] = {
    var table = [String: Int](minimumCapacity: jointNames.count)
    for (index, name) in jointNames.enumerated() {
      table[name] = index
    }
    return table
  }()

  static func indexOf(_ name: String) -> Int {
    return nameToIndex[name] ?? -1
  }

  /// 35 pairs, flattened: a flat array avoids per-segment tuple copies on the draw path.
  static let connections: [Int] = [
    nose, leftEyeInner,
    leftEyeInner, leftEye,
    leftEye, leftEyeOuter,
    leftEyeOuter, leftEar,
    nose, rightEyeInner,
    rightEyeInner, rightEye,
    rightEye, rightEyeOuter,
    rightEyeOuter, rightEar,
    mouthLeft, mouthRight,
    leftShoulder, rightShoulder,
    leftShoulder, leftElbow,
    leftElbow, leftWrist,
    leftWrist, leftPinky,
    leftWrist, leftIndex,
    leftWrist, leftThumb,
    leftPinky, leftIndex,
    rightShoulder, rightElbow,
    rightElbow, rightWrist,
    rightWrist, rightPinky,
    rightWrist, rightIndex,
    rightWrist, rightThumb,
    rightPinky, rightIndex,
    leftShoulder, leftHip,
    rightShoulder, rightHip,
    leftHip, rightHip,
    leftHip, leftKnee,
    rightHip, rightKnee,
    leftKnee, leftAnkle,
    rightKnee, rightAnkle,
    leftAnkle, leftHeel,
    rightAnkle, rightHeel,
    leftHeel, leftFootIndex,
    rightHeel, rightFootIndex,
    leftAnkle, leftFootIndex,
    rightAnkle, rightFootIndex
  ]

  static let connectionCount = 35

  /**
   `[proximal, vertex, distal]` for each of the 12 joints where two limb segments meet, in the
   order `ANGLE_JOINT_NAMES` declares them. An array of pairs rather than a dictionary: order is
   the contract here, and Swift dictionaries do not have one.
   */
  private static let angleTriples: [(joint: String, triple: [Int])] = [
    ("leftShoulder", [leftHip, leftShoulder, leftElbow]),
    ("rightShoulder", [rightHip, rightShoulder, rightElbow]),
    ("leftElbow", [leftShoulder, leftElbow, leftWrist]),
    ("rightElbow", [rightShoulder, rightElbow, rightWrist]),
    ("leftWrist", [leftElbow, leftWrist, leftIndex]),
    ("rightWrist", [rightElbow, rightWrist, rightIndex]),
    ("leftHip", [leftShoulder, leftHip, leftKnee]),
    ("rightHip", [rightShoulder, rightHip, rightKnee]),
    ("leftKnee", [leftHip, leftKnee, leftAnkle]),
    ("rightKnee", [rightHip, rightKnee, rightAnkle]),
    ("leftAnkle", [leftKnee, leftAnkle, leftFootIndex]),
    ("rightAnkle", [rightKnee, rightAnkle, rightFootIndex])
  ]

  /**
   The 12 angle joints in wire order. Derived from the table above rather than listed again, so a
   reorder there cannot leave a second list disagreeing with it.
   */
  static let angleJointNames: [String] = angleTriples.map(\.joint)

  private static let angleTripleTable: [String: [Int]] = {
    var table = [String: [Int]](minimumCapacity: angleTriples.count)
    for entry in angleTriples {
      table[entry.joint] = entry.triple
    }
    return table
  }()

  static func angleTriple(_ joint: String) -> [Int]? {
    return angleTripleTable[joint]
  }
}
