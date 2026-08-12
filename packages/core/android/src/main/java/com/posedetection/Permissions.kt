package com.posedetection

import android.Manifest
import expo.modules.interfaces.permissions.PermissionsResponse
import expo.modules.interfaces.permissions.PermissionsStatus

/**
 * `canAskAgain` is the field that matters. Without it an app cannot tell a refusal it may ask
 * about again from one the system will never prompt for, and it shows a button that does nothing.
 */
internal fun permissionResult(
    status: PermissionsStatus,
    canAskAgain: Boolean,
): Map<String, Any?> =
    mapOf(
        "status" to status.status,
        "canAskAgain" to canAskAgain,
    )

internal fun toPermissionResult(result: Map<String, PermissionsResponse>): Map<String, Any?> {
    val response = result[Manifest.permission.CAMERA] ?: return permissionResult(PermissionsStatus.UNDETERMINED, true)
    return permissionResult(response.status, response.canAskAgain)
}
