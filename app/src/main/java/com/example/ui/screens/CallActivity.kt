package com.example.ui.screens

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.example.CrashLogger
import com.example.R
import io.agora.rtc2.Constants
import io.agora.rtc2.ChannelMediaOptions
import io.agora.rtc2.IRtcEngineEventHandler
import io.agora.rtc2.RtcEngine
import io.agora.rtc2.RtcEngineConfig
import io.agora.rtc2.video.VideoCanvas
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class CallActivity : AppCompatActivity() {

    companion object {
        const val ROOM_ID = "ROOM_ID"
        const val USER_ID = "USER_ID"
        const val USER_NAME = "USER_NAME"
        const val IS_VIDEO = "IS_VIDEO"
        const val CONSULTATION_ID = "CONSULTATION_ID"
        const val PEER_NAME = "PEER_NAME"
        const val APP_ID = "854c306723a44d838db956729bedb7f7"
        const val TOKEN_SERVER = "http://167.86.124.101:9999"
    }

    private var engine: RtcEngine? = null
    private var isVideo = false
    private var isMuted = false
    private var isCameraOn = true
    private var isSpeakerOn = false
    private var consultationId = ""
    private var callEndReceiver: android.content.BroadcastReceiver? = null
    private var callStartTime = 0L
    private val handler = Handler(Looper.getMainLooper())
    private var timerRunnable: Runnable? = null

    private lateinit var statusText: TextView
    private lateinit var timerText: TextView
    private lateinit var btnMute: ImageButton
    private lateinit var btnSpeaker: ImageButton
    private lateinit var btnCamera: ImageButton
    private lateinit var btnHangup: ImageButton
    private lateinit var localVideoContainer: FrameLayout
    private lateinit var remoteVideoContainer: FrameLayout

    private val rtcHandler = object : IRtcEngineEventHandler() {
        override fun onJoinChannelSuccess(channel: String, uid: Int, elapsed: Int) {
            CrashLogger.log("[AGORA] JOINED OK: channel=$channel uid=$uid")
            runOnUiThread { statusText.text = "En attente..." }
        }

        override fun onUserJoined(uid: Int, elapsed: Int) {
            CrashLogger.log("[AGORA] Remote joined: uid=$uid")
            runOnUiThread {
                statusText.text = "Appel connect\u00e9"
                timerText.visibility = View.VISIBLE
                callStartTime = System.currentTimeMillis()
                startTimer()
                if (isVideo) {
                    val surfaceView = android.view.SurfaceView(this@CallActivity)
                    remoteVideoContainer.removeAllViews()
                    remoteVideoContainer.addView(surfaceView)
                    engine?.setupRemoteVideo(VideoCanvas(surfaceView, VideoCanvas.RENDER_MODE_FIT, uid))
                }
            }
        }

        override fun onUserOffline(uid: Int, reason: Int) {
            CrashLogger.log("[AGORA] Remote left: uid=$uid reason=$reason")
            runOnUiThread {
                statusText.text = "Appel termin\u00e9"
                stopTimer()
                handler.postDelayed({ finish() }, 1500)
            }
        }

        override fun onRemoteAudioStateChanged(uid: Int, state: Int, reason: Int, elapsed: Int) {
            CrashLogger.log("[AGORA] Remote audio state: uid=$uid state=$state reason=$reason")
        }

        override fun onRemoteVideoStateChanged(uid: Int, state: Int, reason: Int, elapsed: Int) {
            CrashLogger.log("[AGORA] Remote video state: uid=$uid state=$state reason=$reason")
        }

        override fun onError(err: Int) {
            CrashLogger.log("[AGORA] Error code: $err")
            val msg = when (err) {
                110 -> "Token invalide (110)"
                109 -> "Token expire (109)"
                2 -> "Erreur r\u00e9seau (2)"
                3 -> "Erreur API (3)"
                else -> "Erreur $err"
            }
            runOnUiThread { statusText.text = msg }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_call)

        val roomId = intent.getStringExtra(ROOM_ID)
        val userId = intent.getStringExtra(USER_ID) ?: "0"
        isVideo = intent.getBooleanExtra(IS_VIDEO, false)
        if (roomId == null) { finish(); return }

        consultationId = intent.getStringExtra(CONSULTATION_ID) ?: roomId

        CrashLogger.log("[AGORA] Start: room=$roomId user=$userId video=$isVideo")

        statusText = findViewById(R.id.callStatusText)
        timerText = findViewById(R.id.callTimerText)
        btnMute = findViewById(R.id.btnMute)
        btnSpeaker = findViewById(R.id.btnSpeaker)
        btnCamera = findViewById(R.id.btnCamera)
        btnHangup = findViewById(R.id.btnHangup)
        localVideoContainer = findViewById(R.id.localVideoContainer)
        remoteVideoContainer = findViewById(R.id.remoteVideoContainer)

        if (isVideo) {
            localVideoContainer.visibility = View.VISIBLE
            btnCamera.visibility = View.VISIBLE
        }

        btnMute.setOnClickListener { isMuted = !isMuted; engine?.muteLocalAudioStream(isMuted); btnMute.alpha = if (isMuted) 0.4f else 1.0f }
        btnSpeaker.setOnClickListener { isSpeakerOn = !isSpeakerOn; engine?.setEnableSpeakerphone(isSpeakerOn); btnSpeaker.alpha = if (isSpeakerOn) 1.0f else 0.4f }
        btnCamera.setOnClickListener {
                isCameraOn = !isCameraOn
                engine?.muteLocalVideoStream(!isCameraOn)
                btnCamera.alpha = if (isCameraOn) 1.0f else 0.4f
            }
        btnHangup.setOnClickListener { sendCallEndAndFinish() }

        findViewById<View>(R.id.btnBack)?.setOnClickListener { sendCallEndAndFinish() }

        // Display peer name
        val peerName = intent.getStringExtra(PEER_NAME)
        val remoteUserNameView = findViewById<android.widget.TextView>(R.id.remoteUserName)
        if (!peerName.isNullOrBlank()) {
            remoteUserNameView.text = peerName
            // Set avatar initial
            val initial = peerName.take(1).uppercase()
            findViewById<android.widget.TextView>(R.id.avatarInitial)?.text = initial.toString()
        }

        // Listen for call ended/rejected broadcast from ViewModel
        callEndReceiver = object : android.content.BroadcastReceiver() {
            override fun onReceive(context: android.content.Context?, intent: android.content.Intent?) {
                val reason = intent?.getStringExtra("reason") ?: "ended"
                val msg = if (reason == "rejected") "Appel rejeté" else "Appel terminé"
                statusText.text = msg
                stopTimer()
                handler.postDelayed({ finish() }, 1200)
            }
        }
        registerReceiver(callEndReceiver, android.content.IntentFilter("com.example.ACTION_CALL_END"))

        val uid = userId.hashCode().toLong() and 0xFFFFFFFFL
        fetchTokenAndJoin(roomId, uid.toInt())
    }

    private fun fetchTokenAndJoin(roomId: String, uid: Int) {
        statusText.text = "Obtention du token..."
        Thread {
            try {
                val url = "$TOKEN_SERVER/token?channel=${java.net.URLEncoder.encode(roomId, "UTF-8")}&uid=$uid"
                CrashLogger.log("[AGORA] Fetching: $url")
                val connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 8000
                connection.readTimeout = 8000
                val httpCode = connection.responseCode
                CrashLogger.log("[AGORA] HTTP $httpCode")
                if (httpCode != 200) {
                    val errBody = connection.errorStream?.bufferedReader()?.readText() ?: "no body"
                    CrashLogger.log("[AGORA] HTTP error: $errBody")
                    runOnUiThread { statusText.text = "Erreur serveur token" }
                    return@Thread
                }
                val response = connection.inputStream.bufferedReader().readText()
                val json = JSONObject(response)
                val token = json.getString("token")
                CrashLogger.log("[AGORA] Token OK, len=${token.length}, prefix=${token.take(6)}")
                runOnUiThread {
                    statusText.text = "Connexion..."
                    joinChannel(token, roomId, uid)
                }
            } catch (e: Exception) {
                CrashLogger.log("[AGORA] Token fetch FAILED: ${e.javaClass.simpleName}: ${e.message}")
                runOnUiThread {
                    statusText.text = "Erreur connexion serveur"
                    Toast.makeText(this@CallActivity, "Erreur: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun joinChannel(token: String, roomId: String, uid: Int) {
        try {
            val config = RtcEngineConfig()
            config.mContext = applicationContext
            config.mAppId = APP_ID
            config.mEventHandler = rtcHandler
            engine = RtcEngine.create(config)

            // Set channel profile for 1-to-1 voice/video call
            engine?.setChannelProfile(Constants.CHANNEL_PROFILE_COMMUNICATION)
            engine?.setClientRole(Constants.CLIENT_ROLE_BROADCASTER)

            engine?.enableAudio()

            if (isVideo) {
                engine?.enableVideo()
                val localSurface = android.view.SurfaceView(this)
                localVideoContainer.addView(localSurface)
                engine?.setupLocalVideo(VideoCanvas(localSurface, VideoCanvas.RENDER_MODE_FIT, 0))
                engine?.startPreview()
            }

            // Use SDK 4.4.0 new joinChannel API with ChannelMediaOptions
            val options = ChannelMediaOptions()
            options.publishMicrophoneTrack = true
            options.publishCameraTrack = isVideo
            options.autoSubscribeAudio = true
            options.autoSubscribeVideo = true
            options.clientRoleType = Constants.CLIENT_ROLE_BROADCASTER

            CrashLogger.log("[AGORA] joinChannel (new API): token_len=${token.length} room=$roomId uid=$uid mic=true camera=$isVideo")
            val result = engine?.joinChannel(token, roomId, uid, options)
            CrashLogger.log("[AGORA] joinChannel result: $result")
            engine?.setEnableSpeakerphone(false)
        } catch (e: Throwable) {
            CrashLogger.log("[AGORA] FATAL: ${e.javaClass.name}: ${e.message}")
            Toast.makeText(this, "Erreur: ${e.message}", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun startTimer() {
        timerRunnable = object : Runnable {
            override fun run() {
                val s = ((System.currentTimeMillis() - callStartTime) / 1000).toInt()
                timerText.text = "%02d:%02d".format(s / 60, s % 60)
                handler.postDelayed(this, 1000)
            }
        }
        handler.post(timerRunnable!!)
    }

    private fun stopTimer() { timerRunnable?.let { handler.removeCallbacks(it) }; timerRunnable = null }

    private fun sendCallEndAndFinish() {
        stopTimer()
        try {
            com.example.data.api.MedikaNetwork.sendCallEnd(consultationId)
            CrashLogger.log("[AGORA] Sent call:end for $consultationId")
        } catch (e: Throwable) {
            CrashLogger.log("[AGORA] sendCallEnd error: ${e.message}")
        }
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        try { callEndReceiver?.let { unregisterReceiver(it) } } catch (_: Exception) {}
        callEndReceiver = null
        stopTimer()
        try {
            com.example.data.api.MedikaNetwork.sendCallEnd(consultationId)
        } catch (_: Throwable) {}
        try { engine?.leaveChannel() } catch (_: Throwable) {}
        engine = null
    }
}
