package com.example

import android.content.Context
import android.os.Environment
import android.util.Log
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Writes crash logs and diagnostic info to a file on the device that the user
 * can access and share. The file is at:
 *   /sdcard/Android/data/com.medika.santelien/files/MedikaLogs/crash_log.txt
 *   /sdcard/Android/data/com.medika.santelien/files/MedikaLogs/diagnostic_log.txt
 *
 * Uses the app's external files directory (getExternalFilesDir) which requires
 * NO permissions and is accessible via any file manager app.
 */
object CrashLogger {

    private const val TAG = "MedikaCrashLogger"
    private const val LOG_DIR = "MedikaLogs"
    private const val CRASH_FILE = "crash_log.txt"
    private const val DIAG_FILE = "diagnostic_log.txt"

    private lateinit var appContext: Context

    fun init(context: Context) {
        appContext = context.applicationContext
        getLogDir().mkdirs()
        log("=== Medika app started at ${now()} ===")
    }

    private fun getLogDir(): File {
        // Use the app's external files directory — no permission needed,
        // and the user can access it via file manager at:
        //   Android/data/com.medika.santelien/files/MedikaLogs/
        return File(appContext.getExternalFilesDir(null), LOG_DIR)
    }

    fun getCrashLogFile(): File = File(getLogDir(), CRASH_FILE)
    fun getDiagLogFile(): File = File(getLogDir(), DIAG_FILE)

    private fun now(): String {
        return SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(Date())
    }

    /** Append a diagnostic message to the diagnostic log file. */
    fun log(message: String) {
        try {
            if (!::appContext.isInitialized) return
            val line = "[${now()}] $message\n"
            getDiagLogFile().appendText(line)
            Log.d(TAG, message)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to write diag log: ${e.message}")
        }
    }

    /** Write the full crash stack trace to the crash log file. */
    fun logCrash(thread: Thread, throwable: Throwable) {
        try {
            val sw = StringWriter()
            sw.write("═══════════════════════════════════════════════════════\n")
            sw.write("CRASH at ${now()}\n")
            sw.write("Thread: ${thread.name}\n")
            sw.write("Exception: ${throwable.javaClass.name}: ${throwable.message}\n")
            sw.write("Stack trace:\n")
            throwable.printStackTrace(PrintWriter(sw))
            sw.write("═══════════════════════════════════════════════════════\n\n")

            // Append to the crash file (keep history)
            getCrashLogFile().appendText(sw.toString())

            // Also log to logcat
            Log.e("MEDIKA_CRASH", sw.toString())
        } catch (e: Exception) {
            Log.e(TAG, "Failed to write crash log: ${e.message}")
        }
    }

    /** Read the diagnostic log file contents (for in-app display). */
    fun readDiagLog(): String {
        return try {
            val file = getDiagLogFile()
            if (file.exists()) file.readText().takeLast(5000) else "No diagnostic log yet."
        } catch (e: Exception) {
            "Error reading log: ${e.message}"
        }
    }

    /** Read the crash log file contents (for in-app display). */
    fun readCrashLog(): String {
        return try {
            val file = getCrashLogFile()
            if (file.exists()) file.readText().takeLast(8000) else "No crashes recorded."
        } catch (e: Exception) {
            "Error reading crash log: ${e.message}"
        }
    }
}
