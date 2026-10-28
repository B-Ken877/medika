package com.example

import android.app.Application
import android.util.Log
import android.widget.Toast

class MedikaApplication : Application() {

    companion object {
        private const val TAG = "MedikaApp"
        const val CRASH_TAG = "MEDIKA_CRASH"
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "MedikaApplication.onCreate()")

        CrashLogger.init(this)
        CrashLogger.log("MedikaApplication.onCreate()")

        // Read the ZEGO provider boot log if it exists. This was written by
        // SafePrebuiltCallInitializer which runs BEFORE this onCreate(), so
        // it uses raw file I/O instead of CrashLogger. Copy it into CrashLogger
        // now so it shows up in the normal crash log.
        try {
            val bootLog = java.io.File(filesDir, "zego_provider_boot.log")
            if (bootLog.exists()) {
                CrashLogger.log("[ZEGO_PROVIDER_BOOT] ${bootLog.readText()}")
            }
        } catch (e: Exception) {
            CrashLogger.log("[ZEGO_PROVIDER_BOOT] failed to read boot log: ${e.message}")
        }

        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        CrashLogger.log("Previous crash handler: ${previousHandler?.javaClass?.name}")

        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            CrashLogger.logCrash(thread, throwable)
            try {
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    Toast.makeText(
                        this,
                        "Medika crash: ${throwable.javaClass.simpleName}: ${throwable.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            } catch (_: Exception) {}
            previousHandler?.uncaughtException(thread, throwable)
        }

        CrashLogger.log("Crash handler installed OK")
    }
}
