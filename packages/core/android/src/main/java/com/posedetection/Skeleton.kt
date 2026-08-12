package com.posedetection

/**
 * BlazePose landmark order, the skeleton, and the joints that have an angle. These three tables
 * are the contract from `src/types/joints.ts`, and iOS carries the same three. Any divergence is
 * a bug even when each side looks right alone.
 */
internal object Skeleton {
    const val LANDMARK_COUNT = 33
    const val LANDMARK_STRIDE = 4

    const val OFFSET_X = 0
    const val OFFSET_Y = 1
    const val OFFSET_Z = 2
    const val OFFSET_VISIBILITY = 3

    const val NOSE = 0
    const val LEFT_EYE_INNER = 1
    const val LEFT_EYE = 2
    const val LEFT_EYE_OUTER = 3
    const val RIGHT_EYE_INNER = 4
    const val RIGHT_EYE = 5
    const val RIGHT_EYE_OUTER = 6
    const val LEFT_EAR = 7
    const val RIGHT_EAR = 8
    const val MOUTH_LEFT = 9
    const val MOUTH_RIGHT = 10
    const val LEFT_SHOULDER = 11
    const val RIGHT_SHOULDER = 12
    const val LEFT_ELBOW = 13
    const val RIGHT_ELBOW = 14
    const val LEFT_WRIST = 15
    const val RIGHT_WRIST = 16
    const val LEFT_PINKY = 17
    const val RIGHT_PINKY = 18
    const val LEFT_INDEX = 19
    const val RIGHT_INDEX = 20
    const val LEFT_THUMB = 21
    const val RIGHT_THUMB = 22
    const val LEFT_HIP = 23
    const val RIGHT_HIP = 24
    const val LEFT_KNEE = 25
    const val RIGHT_KNEE = 26
    const val LEFT_ANKLE = 27
    const val RIGHT_ANKLE = 28
    const val LEFT_HEEL = 29
    const val RIGHT_HEEL = 30
    const val LEFT_FOOT_INDEX = 31
    const val RIGHT_FOOT_INDEX = 32

    val JOINT_NAMES =
        arrayOf(
            "nose",
            "leftEyeInner",
            "leftEye",
            "leftEyeOuter",
            "rightEyeInner",
            "rightEye",
            "rightEyeOuter",
            "leftEar",
            "rightEar",
            "mouthLeft",
            "mouthRight",
            "leftShoulder",
            "rightShoulder",
            "leftElbow",
            "rightElbow",
            "leftWrist",
            "rightWrist",
            "leftPinky",
            "rightPinky",
            "leftIndex",
            "rightIndex",
            "leftThumb",
            "rightThumb",
            "leftHip",
            "rightHip",
            "leftKnee",
            "rightKnee",
            "leftAnkle",
            "rightAnkle",
            "leftHeel",
            "rightHeel",
            "leftFootIndex",
            "rightFootIndex",
        )

    private val NAME_TO_INDEX: Map<String, Int> =
        JOINT_NAMES.withIndex().associate { (index, name) -> name to index }

    fun indexOf(name: String): Int = NAME_TO_INDEX[name] ?: -1

    /** 35 pairs, flattened: a primitive array avoids boxing on the per-frame draw path. */
    val CONNECTIONS =
        intArrayOf(
            NOSE,
            LEFT_EYE_INNER,
            LEFT_EYE_INNER,
            LEFT_EYE,
            LEFT_EYE,
            LEFT_EYE_OUTER,
            LEFT_EYE_OUTER,
            LEFT_EAR,
            NOSE,
            RIGHT_EYE_INNER,
            RIGHT_EYE_INNER,
            RIGHT_EYE,
            RIGHT_EYE,
            RIGHT_EYE_OUTER,
            RIGHT_EYE_OUTER,
            RIGHT_EAR,
            MOUTH_LEFT,
            MOUTH_RIGHT,
            LEFT_SHOULDER,
            RIGHT_SHOULDER,
            LEFT_SHOULDER,
            LEFT_ELBOW,
            LEFT_ELBOW,
            LEFT_WRIST,
            LEFT_WRIST,
            LEFT_PINKY,
            LEFT_WRIST,
            LEFT_INDEX,
            LEFT_WRIST,
            LEFT_THUMB,
            LEFT_PINKY,
            LEFT_INDEX,
            RIGHT_SHOULDER,
            RIGHT_ELBOW,
            RIGHT_ELBOW,
            RIGHT_WRIST,
            RIGHT_WRIST,
            RIGHT_PINKY,
            RIGHT_WRIST,
            RIGHT_INDEX,
            RIGHT_WRIST,
            RIGHT_THUMB,
            RIGHT_PINKY,
            RIGHT_INDEX,
            LEFT_SHOULDER,
            LEFT_HIP,
            RIGHT_SHOULDER,
            RIGHT_HIP,
            LEFT_HIP,
            RIGHT_HIP,
            LEFT_HIP,
            LEFT_KNEE,
            RIGHT_HIP,
            RIGHT_KNEE,
            LEFT_KNEE,
            LEFT_ANKLE,
            RIGHT_KNEE,
            RIGHT_ANKLE,
            LEFT_ANKLE,
            LEFT_HEEL,
            RIGHT_ANKLE,
            RIGHT_HEEL,
            LEFT_HEEL,
            LEFT_FOOT_INDEX,
            RIGHT_HEEL,
            RIGHT_FOOT_INDEX,
            LEFT_ANKLE,
            LEFT_FOOT_INDEX,
            RIGHT_ANKLE,
            RIGHT_FOOT_INDEX,
        )

    const val CONNECTION_COUNT = 35

    /** `[proximal, vertex, distal]` for each of the 12 joints where two limb segments meet. */
    private val ANGLE_TRIPLES: Map<String, IntArray> =
        mapOf(
            "leftShoulder" to intArrayOf(LEFT_HIP, LEFT_SHOULDER, LEFT_ELBOW),
            "rightShoulder" to intArrayOf(RIGHT_HIP, RIGHT_SHOULDER, RIGHT_ELBOW),
            "leftElbow" to intArrayOf(LEFT_SHOULDER, LEFT_ELBOW, LEFT_WRIST),
            "rightElbow" to intArrayOf(RIGHT_SHOULDER, RIGHT_ELBOW, RIGHT_WRIST),
            "leftWrist" to intArrayOf(LEFT_ELBOW, LEFT_WRIST, LEFT_INDEX),
            "rightWrist" to intArrayOf(RIGHT_ELBOW, RIGHT_WRIST, RIGHT_INDEX),
            "leftHip" to intArrayOf(LEFT_SHOULDER, LEFT_HIP, LEFT_KNEE),
            "rightHip" to intArrayOf(RIGHT_SHOULDER, RIGHT_HIP, RIGHT_KNEE),
            "leftKnee" to intArrayOf(LEFT_HIP, LEFT_KNEE, LEFT_ANKLE),
            "rightKnee" to intArrayOf(RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE),
            "leftAnkle" to intArrayOf(LEFT_KNEE, LEFT_ANKLE, LEFT_FOOT_INDEX),
            "rightAnkle" to intArrayOf(RIGHT_KNEE, RIGHT_ANKLE, RIGHT_FOOT_INDEX),
        )

    /**
     * The 12 angle joints in wire order. Derived from the table above rather than listed again, so
     * a reorder there cannot leave a second list disagreeing with it. `mapOf` keeps insertion
     * order, and that order is `ANGLE_JOINT_NAMES` in `src/types/joints.ts`.
     */
    val ANGLE_JOINT_NAMES: Array<String> = ANGLE_TRIPLES.keys.toTypedArray()

    fun angleTriple(joint: String): IntArray? = ANGLE_TRIPLES[joint]
}
