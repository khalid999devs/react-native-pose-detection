package com.posedetection.engine

import com.posedetection.LogCategory
import com.posedetection.PoseLog
import com.posedetection.Skeleton

internal const val DEFAULT_THROTTLE_MS = 100L
internal const val DEFAULT_FLUSH_MS = 500L

/** `data.angles` and `data.select` are not read here: they arrive resolved, as their own props. */
internal fun parseData(raw: Map<*, *>?): DataSettings {
    if (raw == null) {
        return DataSettings(DataMode.OFF, DEFAULT_THROTTLE_MS, DEFAULT_FLUSH_MS, true, false)
    }
    return DataSettings(
        mode = DataMode.from(raw["mode"] as? String),
        // A zero or negative interval would emit on every frame under a name that promises not to.
        throttleMs = (raw["throttleMs"] as? Number)?.toLong()?.coerceAtLeast(1L) ?: DEFAULT_THROTTLE_MS,
        flushMs = (raw["flushMs"] as? Number)?.toLong()?.coerceAtLeast(1L) ?: DEFAULT_FLUSH_MS,
        landmarks = raw["landmarks"] as? Boolean ?: true,
        worldLandmarks = raw["worldLandmarks"] as? Boolean ?: false,
    )
}

/** In the order named, which is the order `PoseFrame.selection` promises. Unknown names drop out. */
internal fun parseSelection(names: List<String>): IntArray {
    val indices = IntArray(names.size)
    var count = 0
    for (name in names) {
        val index = Skeleton.indexOf(name)
        if (index >= 0) {
            indices[count] = index
            count += 1
        } else {
            PoseLog.warn(LogCategory.DETECTOR) { "data.select named $name, which is not a joint" }
        }
    }
    return if (count == names.size) indices else indices.copyOf(count)
}
