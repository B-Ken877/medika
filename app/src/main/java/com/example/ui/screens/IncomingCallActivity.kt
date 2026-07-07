package com.example.ui.screens

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.example.CrashLogger
import com.example.R

class IncomingCallActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_ROOM_ID = "room_id"
        const val EXTRA_CALLER_ID = "caller_id"
        const val EXTRA_CALLER_NAME = "caller_name"
        const val EXTRA_IS_VIDEO = "is_video"
        const val EXTRA_CONSULTATION_ID = "consultation_id"
        private const val AUTO_REJECT_MS = 30_000L
    }

    private lateinit var callerNameText: TextView
    private lateinit var callTypeText: TextView
    private lateinit var btnAccept: View
    private lateinit var btnReject: View
    private lateinit var avatarPulse: View
    private val handler = Handler(Looper.getMainLooper())
    private var ringtone: Ringtone? = null
    private var roomId = ""
    private var callerId = ""
    private var callerName = ""
    private var isVideo = false
    private var consultationId = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Show over lock screen and other apps
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }

        setContentView(R.layout.activity_incoming_call)

        roomId = intent.getStringExtra(EXTRA_ROOM_ID) ?: ""
        callerId = intent.getStringExtra(EXTRA_CALLER_ID) ?: ""
        callerName = intent.getStringExtra(EXTRA_CALLER_NAME) ?: "Inconnu"
        isVideo = intent.getBooleanExtra(EXTRA_IS_VIDEO, false)
        consultationId = intent.getStringExtra(EXTRA_CONSULTATION_ID) ?: roomId

        callerNameText = findViewById(R.id.incomingCallerName)
        callTypeText = findViewById(R.id.incomingCallType)
        btnAccept = findViewById(R.id.btnAcceptCall)
        btnReject = findViewById(R.id.btnRejectCall)
        avatarPulse = findViewById(R.id.incomingAvatarPulse)

        callerNameText.text = callerName
        callTypeText.text = if (isVideo) "Appel video entrant" else "Appel vocal entrant"

        btnAccept.setOnClickListener { acceptCall() }
        btnReject.setOnClickListener { rejectCall() }

        startRinging()
        startPulseAnimation()

        // Auto-reject after 30s
        handler.postDelayed({ if (!isFinishing && !isDestroyed) rejectCall() }, AUTO_REJECT_MS)

        CrashLogger.log("[INCOMING] Showing incoming call UI: from=$callerName room=$roomId")
    }

    private fun startRinging() {
        try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ringtone = RingtoneManager.getRingtone(applicationContext, uri)
            ringtone?.play()
        } catch (e: Exception) {
            CrashLogger.log("[INCOMING] Ringtone error: ${e.message}")
        }
    }

    private fun stopRinging() {
        try { ringtone?.stop() } catch (_: Exception) {}
        ringtone = null
    }

    private fun startPulseAnimation() {
        avatarPulse.animate()
            .scaleX(1.15f).scaleY(1.15f)
            .setDuration(600)
            .withEndAction {
                if (!isFinishing) {
                    avatarPulse.animate()
                        .scaleX(1.0f).scaleY(1.0f)
                        .setDuration(600)
                        .withEndAction { if (!isFinishing) startPulseAnimation() }
                        .start()
                }
            }
            .start()
    }

    private fun acceptCall() {
        handler.removeCallbacksAndMessages(null)
        stopRinging()
        CrashLogger.log("[INCOMING] Call ACCEPTED: room=$roomId from=$callerName")

        // Notify server
        try {
            com.example.data.api.MedikaNetwork.sendCallAccept(consultationId)
        } catch (e: Exception) {
            CrashLogger.log("[INCOMING] sendCallAccept error: ${e.message}")
        }

        // Get user info from SharedPreferences
        val prefs = getSharedPreferences("medika_prefs", android.content.Context.MODE_PRIVATE)
        val myId = prefs.getString("user_id", "") ?: ""
        val myName = prefs.getString("user_name", "") ?: "User"

        // Launch CallActivity directly
        try {
            startActivity(
                Intent(this, CallActivity::class.java).apply {
                    putExtra("ROOM_ID", roomId)
                    putExtra("USER_ID", myId)
                    putExtra("USER_NAME", myName)
                    putExtra("IS_VIDEO", isVideo)
                    putExtra("CONSULTATION_ID", consultationId)
                }
            )
            CrashLogger.log("[INCOMING] Launched CallActivity: room=$roomId uid=$myId")
        } catch (e: Throwable) {
            CrashLogger.log("[INCOMING] Failed to launch CallActivity: ${e.message}")
            Toast.makeText(this, "Erreur: ${e.message}", Toast.LENGTH_LONG).show()
        }

        finish()
    }

    private fun rejectCall() {
        handler.removeCallbacksAndMessages(null)
        stopRinging()
        CrashLogger.log("[INCOMING] Call REJECTED: room=$roomId from=$callerName")

        // Send rejection signal back
        try {
            com.example.data.livekit.ZegoChatManager.sendCallRejectSignal(
                toUserId = callerId,
                roomId = roomId
            )
        } catch (e: Exception) {
            CrashLogger.log("[INCOMING] Send reject signal error: ${e.message}")
        }

        setResult(Activity.RESULT_CANCELED)
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacksAndMessages(null)
        stopRinging()
    }
}
