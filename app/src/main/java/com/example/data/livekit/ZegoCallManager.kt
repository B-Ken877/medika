package com.example.data.livekit

import android.app.Application
import android.util.Log
import com.example.CrashLogger
import com.zegocloud.uikit.prebuilt.call.ZegoUIKitPrebuiltCallService
import com.zegocloud.uikit.prebuilt.call.invite.ZegoUIKitPrebuiltCallInvitationConfig

/**
 * Manages ZEGOCLOUD UIKit Prebuilt Call service lifecycle.
 */
object ZegoCallManager {

    private const val TAG = "[ZEGO]"
    private const val APP_ID: Long = 797048152L
    private const val APP_SIGN = "2354370a67b4ec724ff5328f31d03367532fdabe65420681f58f7ff98fc672d2"

    @Volatile
    private var initialized = false

    /** Returns true if ZegoUIKitPrebuiltCallService has been successfully initialized. */
    fun isInitialized(): Boolean = initialized

    @Volatile
    private var currentUserId: String? = null

    fun getCurrentUserId(): String? = currentUserId

    fun init(application: Application, userId: String, userName: String) {
        if (userId.isBlank()) {
            Log.e(TAG, "init() called with blank userId — aborting")
            CrashLogger.log("[ZEGO] init FAILED: blank userId")
            return
        }
        val displayName = if (userName.isBlank()) "User" else userName
        val config = ZegoUIKitPrebuiltCallInvitationConfig()
        try {
            Log.d(TAG, "Initializing ZegoUIKitPrebuiltCallService: appID=$APP_ID, userId=$userId")
            CrashLogger.log("[ZEGO] init starting: appID=$APP_ID, userId=$userId, name=$displayName")
            ZegoUIKitPrebuiltCallService.init(
                application,
                APP_ID,
                APP_SIGN,
                userId,
                displayName,
                config
            )
            initialized = true
            currentUserId = userId
            Log.d(TAG, "ZegoUIKitPrebuiltCallService initialized OK: userId=$userId")
            CrashLogger.log("[ZEGO] init SUCCESS: userId=$userId")
        } catch (e: Throwable) {
            initialized = false
            Log.e(TAG, "FAILED to init ZegoUIKitPrebuiltCallService: ${e.javaClass.name}: ${e.message}", e)
            CrashLogger.log("[ZEGO] init FAILED: ${e.javaClass.name}: ${e.message}")
        }
    }

    fun uninit() {
        try {
            ZegoUIKitPrebuiltCallService.unInit()
            initialized = false
            currentUserId = null
            Log.d(TAG, "ZegoUIKitPrebuiltCallService uninitialized")
            CrashLogger.log("[ZEGO] uninit OK")
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to unInit ZegoUIKitPrebuiltCallService: ${e.javaClass.name}: ${e.message}")
            CrashLogger.log("[ZEGO] uninit FAILED: ${e.message}")
        }
    }
}
