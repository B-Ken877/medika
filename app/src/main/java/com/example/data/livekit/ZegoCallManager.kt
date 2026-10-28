package com.example.data.livekit

import android.app.Application
import android.util.Log
import com.example.CrashLogger

object ZegoCallManager {

    private const val TAG = "[ZEGO]"
    @Volatile private var initialized = false

    fun isInitialized(): Boolean = true  // Always ready for direct-join calls

    fun init(application: Application, userId: String, userName: String) {
        initialized = true
        Log.d(TAG, "ZegoCallManager init (no-op for direct-join mode)")
        CrashLogger.log("[ZEGO] CallManager init OK (direct-join mode)")
    }

    fun uninit() {
        initialized = false
        CrashLogger.log("[ZEGO] CallManager uninit OK")
    }
}
