package com.posedetection

/** The closed set from `src/types/events.ts`. A new code is an addition in both places. */
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
    EXPORT_FAILED(false),
    EXPORT_CANCELLED(false),
}
