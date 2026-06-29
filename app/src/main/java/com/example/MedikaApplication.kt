package com.example

import android.app.Application
import android.util.Log
import android.widget.Toast

/**
 * Medika Application class.
 *
 * - Initializes CrashLogger (writes to a file the user can access)
 * - Installs a global UncaughtExceptionHandler that logs crashes to both
 *   logcat and a file, and shows a Toast so the user sees what went wrong.
 * - Chains to the previous handler (which may be Zego's) so Zego's internal
 *   crash reporting still works.
 */
class MedikaApplication : Application() {

    companion object {
        private const val TAG = "MedikaApp"
        const val CRASH_TAG = "MEDIKA_CRASH"
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "MedikaApplication.onCreate()")

        // Initialize crash logger first so we can write to files
        CrashLogger.init(this)
        CrashLogger.log("MedikaApplication.onCreate()")

        // Save the current default handler (may be Zego's, installed by
        // PrebuiltCallInitializer which runs before Application.onCreate).
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        CrashLogger.log("Previous crash handler: ${previousHandler?.javaClass?.name}")

        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            // Log to file and logcat
            CrashLogger.logCrash(thread, throwable)

            // Show a Toast with the crash message (on the main thread)
            try {
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    Toast.makeText(
                        this,
                        "Medika crash: ${throwable.javaClass.simpleName}: ${throwable.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            } catch (_: Exception) {}

            // Chain to the previous handler (Zego's or system default)
            previousHandler?.uncaughtException(thread, throwable)
        }

        CrashLogger.log("Crash handler installed OK")
    }
}
