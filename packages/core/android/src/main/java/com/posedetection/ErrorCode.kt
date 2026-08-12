package com.posedetection

/**
 * The closed set from `src/types/events.ts`. Native emits nothing outside it, which is what lets
 * a consumer switch on `code` exhaustively. A new failure mode is an addition in both places, not
 * a new string in a catch block.
 */
internal enum class ErrorCode(
    val fatal: Boolean,
) {
    PERMISSION_DENIED(true),
    MODEL_NOT_FOUND(true),
    MODEL_LOAD_FAILED(true),
    CAMERA_UNAVAILABLE(true),
    CAMERA_START_FAILED(true),
    DETECTOR_INIT_FAILED(true),
    INVALID_CONFIG(true),
    IMAGE_DECODE_FAILED(true),
    VIDEO_DECODE_FAILED(true),
    CAMERA_SWITCH_FAILED(false),
    GPU_UNAVAILABLE(false),
    DETECTION_FAILED(false),
}
