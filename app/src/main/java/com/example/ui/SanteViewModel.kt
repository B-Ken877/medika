package com.example.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.data.api.*
import com.example.data.db.*
import com.example.data.repository.SanteRepository
import com.example.data.livekit.ZegoCallManager
import com.example.data.livekit.ZegoChatManager
import com.example.data.livekit.ZimIncomingMessage

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import java.util.UUID
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import java.io.File
import java.io.FileOutputStream
import retrofit2.HttpException
import org.json.JSONObject
import java.net.URL
import android.content.Intent
import kotlin.concurrent.thread
import android.content.SharedPreferences
import java.security.MessageDigest
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import android.provider.OpenableColumns

// ─── Auth States ─────────────────────────────────────────────

sealed interface AuthState {
    object Unauthenticated : AuthState
    object Loading : AuthState
    data class PatientAuthenticated(val profile: PatientProfileEntity, val serverUser: UserDto) : AuthState
    data class DoctorAuthenticated(val doctor: DoctorEntity, val serverUser: UserDto) : AuthState
    object AdminAuthenticated : AuthState
    data class Error(val message: String) : AuthState
}

// ─── Intake States ─────────────────────────────────────────────

sealed interface IntakeState {
    object Idle : IntakeState
    object Loading : IntakeState
    data class DoctorsLoaded(val doctors: List<DoctorEntity>, val category: String) : IntakeState
    data class NoDoctors(val category: String) : IntakeState
    data class Error(val message: String) : IntakeState
}

// ─── Call States ────────────────────────────────────────────

enum class CallStatus { RINGING, ACTIVE, DISCONNECTED }
enum class CallType { VOICE, VIDEO }

data class CallSession(
    val consultationId: String,
    val peerName: String,
    val peerAvatar: String? = null,
    val isOutgoing: Boolean,
    val status: CallStatus,
    val callType: CallType,
    val durationSeconds: Int = 0,
    val isMuted: Boolean = false,
    val isSpeakerOn: Boolean = false,
    val isCameraOn: Boolean = true,
    val isMinimized: Boolean = false
)

// ─── ViewModel ───────────────────────────────────────────────

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class SanteViewModel(
    application: Application,
    private val repository: SanteRepository
) : AndroidViewModel(application) {

    private var authToken: String? = null
    private var currentServerUserId: String? = null
    private var currentUserName: String? = null


    // ─── PIN State ─────────────────────────────────
    private val _needsPinSetup = MutableStateFlow(false)
    val needsPinSetup: StateFlow<Boolean> = _needsPinSetup.asStateFlow()

    private val _needsPinVerify = MutableStateFlow(false)
    val needsPinVerify: StateFlow<Boolean> = _needsPinVerify.asStateFlow()

    private val _pinVerifyError = MutableStateFlow<String?>(null)
    val pinVerifyError: StateFlow<String?> = _pinVerifyError.asStateFlow()

    // ─── Session Persistence (SharedPreferences) ──────────
    private val prefs: SharedPreferences by lazy {
        getApplication<Application>().getSharedPreferences("medika_session", android.content.Context.MODE_PRIVATE)
    }

    // ─── State Flows ─────────────────────────────────
    private val _authState = MutableStateFlow<AuthState>(AuthState.Unauthenticated)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    private val _intakeState = MutableStateFlow<IntakeState>(IntakeState.Idle)
    val intakeState: StateFlow<IntakeState> = _intakeState.asStateFlow()

    private val _activeCall = MutableStateFlow<CallSession?>(null)
    val activeCall: StateFlow<CallSession?> = _activeCall.asStateFlow()

    private val _activeConsultationId = MutableStateFlow<String?>(null)
    val activeConsultationId: StateFlow<String?> = _activeConsultationId.asStateFlow()

    private val _serverMessages = MutableStateFlow<List<WsNewMessage>>(emptyList())
    val serverMessages: StateFlow<List<WsNewMessage>> = _serverMessages.asStateFlow()

    private val _wsConnected = MutableStateFlow(false)
    val wsConnected: StateFlow<Boolean> = _wsConnected.asStateFlow()

    // ─── Permission handling ─────────────────────────────
    private val _requestCallPermissions = MutableStateFlow(false)
    val requestCallPermissions: StateFlow<Boolean> = _requestCallPermissions.asStateFlow()
    private var pendingCallParams: Array<Any>? = null
    var pendingCallNeedsVideo = false
        private set

    // Voice recording permission request
    private val _requestMicPermission = MutableStateFlow(false)
    val requestMicPermission: StateFlow<Boolean> = _requestMicPermission.asStateFlow()
    private var pendingVoiceSender: Pair<String, String>? = null
    private var pendingVoiceAction: String? = null // "start" or "stop"

    // Storage permission for media
    private val _requestStoragePermission = MutableStateFlow(false)
    val requestStoragePermission: StateFlow<Boolean> = _requestStoragePermission.asStateFlow()
    private var pendingMediaParams: Triple<String, String, String>? = null

    private val _incomingCall = MutableStateFlow<IncomingCallEvent?>(null)
    val incomingCall: StateFlow<IncomingCallEvent?> = _incomingCall.asStateFlow()

    private val _isTyping = MutableStateFlow(false)
    val isTyping: StateFlow<Boolean> = _isTyping.asStateFlow()

    private val _loginError = MutableStateFlow<String?>(null)
    val loginError: StateFlow<String?> = _loginError.asStateFlow()

    private val _registerError = MutableStateFlow<String?>(null)
    val registerError: StateFlow<String?> = _registerError.asStateFlow()

    // Upload/send errors surfaced to the UI as Toast messages
    private val _uploadError = MutableStateFlow<String?>(null)
    val uploadError: StateFlow<String?> = _uploadError.asStateFlow()

    fun consumeUploadError() { _uploadError.value = null }

    // Zego SDK readiness — true when both Call and Chat services are initialized.
    // The UI uses this to enable/disable call buttons.
    private val _zegoCallReady = MutableStateFlow(false)
    val zegoCallReady: StateFlow<Boolean> = _zegoCallReady.asStateFlow()

    private val _zegoChatReady = MutableStateFlow(false)
    val zegoChatReady: StateFlow<Boolean> = _zegoChatReady.asStateFlow()

    // ─── Specialty Prices (fetched from backend) ──────────────────────
    private val _specialtyPrices = MutableStateFlow<Map<String, Int>>(emptyMap())
    val specialtyPrices: StateFlow<Map<String, Int>> = _specialtyPrices.asStateFlow()

    fun fetchSpecialtyPrices() {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val token = authToken ?: return@launch
                val response = com.example.data.api.MedikaNetwork.api.getSpecialtyPrices(token)
                val priceMap = response.associate { it.name to it.price }
                _specialtyPrices.value = priceMap
                println("[PRICES] Fetched ${priceMap.size} specialty prices")
            } catch (e: Exception) {
                println("[PRICES] Error fetching: ${e.message}")
            }
        }
    }

    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    // ─── Voice Recording ──────────────────────────────
    private val _isRecording = MutableStateFlow(false)
    val isRecording: StateFlow<Boolean> = _isRecording.asStateFlow()

    private val _recordingDuration = MutableStateFlow(0)
    val recordingDuration: StateFlow<Int> = _recordingDuration.asStateFlow()

    private var mediaRecorder: MediaRecorder? = null
    private var currentRecordingFile: File? = null
    private var mediaPlayer: MediaPlayer? = null
    private val _isPlayingVoice = MutableStateFlow(false)
    val isPlayingVoice: StateFlow<Boolean> = _isPlayingVoice.asStateFlow()
    private var recordingTimerJob: kotlinx.coroutines.Job? = null

    // ─── LiveKit ─────────────────────────────────────
    private val _livekitConnected = MutableStateFlow(false)
    val livekitConnected: StateFlow<Boolean> = _livekitConnected.asStateFlow()

    // LiveKit removed — ZEGOCLOUD UIKit manages the call UI.
    private var currentRoomName: String? = null
    private var currentCallIsVideo: Boolean = false

    // ─── Local Data (Room) ─────────────────────────────
    val allDoctors: StateFlow<List<DoctorEntity>> = repository.allDoctors
        .stateIn(viewModelScope, SharingStarted.Lazily, emptyList())

    val allConsultations: StateFlow<List<ConsultationEntity>> = repository.allConsultations
        .stateIn(viewModelScope, SharingStarted.Lazily, emptyList())

    val patientProfile: StateFlow<PatientProfileEntity?> = repository.patientProfile
        .stateIn(viewModelScope, SharingStarted.Lazily, null)

    val activeConsultation: StateFlow<ConsultationEntity?> = _activeConsultationId
        .flatMapLatest { id ->
            if (id == null) flowOf(null)
            else repository.allConsultations.map { list -> list.find { it.id == id } }
        }
        .stateIn(viewModelScope, SharingStarted.Lazily, null)

    /** Display name of the chat peer (doctor name for patients, patient name for doctors). */
    val peerDisplayNameForChat: StateFlow<String> = _activeConsultationId
        .flatMapLatest { id ->
            if (id == null) flowOf("")
            else flow {
                val consultation = repository.getConsultationById(id)
                val auth = _authState.value
                val name = when (auth) {
                    is AuthState.PatientAuthenticated -> {
                        val docId = consultation?.doctorId
                        if (!docId.isNullOrBlank()) {
                            val doc = repository.getDoctorById(docId)
                            if (doc != null) "Dr. ${doc.name}" else "Medecin"
                        } else "Medecin"
                    }
                    is AuthState.DoctorAuthenticated -> {
                        consultation?.patientName ?: "Patient"
                    }
                    else -> "Consultation"
                }
                emit(name)
            }
        }
        .stateIn(viewModelScope, SharingStarted.Lazily, "")

    val activeMessages: StateFlow<List<MessageEntity>> = _activeConsultationId
        .flatMapLatest { id ->
            if (id == null) flowOf(emptyList())
            else repository.getMessagesForConsultation(id)
        }
        .stateIn(viewModelScope, SharingStarted.Lazily, emptyList())

    private var callTimerJob: kotlinx.coroutines.Job? = null
    private var syncPollingJob: kotlinx.coroutines.Job? = null

    // Track processed message IDs to prevent duplicates
    private val processedMessageIds = java.util.concurrent.ConcurrentHashMap<Long, Boolean>()

    // Cache of recently processed call signal room IDs to prevent stale popups on reconnect.
    // ZIM replays undelivered messages when the user reconnects, which would trigger old
    // call_signal messages and show the IncomingCallActivity for calls that ended long ago.
    // Entries auto-expire after 60 seconds.
    private val processedCallSignals = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private val CALL_SIGNAL_MAX_AGE_MS = 45_000L  // 45 seconds

    // ─── Local-first media helpers ─────────────────────────────
    //
    // All voice / image / video files are cached locally under:
    //   app.filesDir/medika/{consultationId}/{kind}_{timestamp}.{ext}
    //
    // Sender flow:  record/copy → insert DB row (sendStatus="sending",
    // localFilePath=<local>) → upload → on success update sendStatus="sent"
    // and fileUrl=serverUrl; on failure update sendStatus="failed".
    //
    // Receiver flow: when a WsNewMessage with a fileUrl arrives, we insert
    // the row immediately (so the bubble shows up), then kick off a background
    // download into the per-consultation folder and update localFilePath.
    private fun medikaMediaDir(consultationId: String): File {
        val app = getApplication<Application>()
        val dir = File(app.filesDir, "medika/$consultationId")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    /** Build the local file path for a received media message based on its server URL. */
    private fun localFileForReceivedMessage(consultationId: String, fileUrl: String?): File? {
        if (fileUrl.isNullOrBlank()) return null
        // fileUrl looks like "/uploads/{consId}/{filename}" or "/uploads/{filename}"
        val name = fileUrl.substringAfterLast('/').ifBlank { return null }
        val dir = medikaMediaDir(consultationId)
        return File(dir, name)
    }

    /** Download a received media file from the server into the per-consultation folder. */
    private suspend fun downloadMediaToLocal(consultationId: String, fileUrl: String): File? = withContext(Dispatchers.IO) {
        try {
            val target = localFileForReceivedMessage(consultationId, fileUrl) ?: return@withContext null
            if (target.exists() && target.length() > 0) return@withContext target
            val fullUrl = "https://medikahaiti.site$fileUrl"
            println("[MEDIA-DL] Downloading $fullUrl -> ${target.absolutePath}")
            java.net.URL(fullUrl).openStream().use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            }
            println("[MEDIA-DL] OK ${target.length()} bytes")
            target
        } catch (e: Exception) {
            println("[MEDIA-DL] Error: ${e.message}")
            null
        }
    }

    /** Download a media file from an absolute URL (e.g. ZIM CDN) into the per-consultation folder. */
    private suspend fun downloadAbsoluteUrlToLocal(consultationId: String, absoluteUrl: String, messageType: String?): File? = withContext(Dispatchers.IO) {
        try {
            val dir = medikaMediaDir(consultationId)
            val urlName = absoluteUrl.substringAfterLast('/').substringBefore('?').ifBlank { "media_${System.currentTimeMillis()}" }
            // Ensure proper extension based on type
            val ext = when (messageType) {
                "voice" -> if (!urlName.endsWith(".m4a") && !urlName.endsWith(".aac") && !urlName.endsWith(".mp3")) ".m4a" else ""
                "image" -> if (!urlName.endsWith(".jpg") && !urlName.endsWith(".png") && !urlName.endsWith(".webp")) ".jpg" else ""
                "video" -> if (!urlName.endsWith(".mp4") && !urlName.endsWith(".3gp")) ".mp4" else ""
                else -> ""
            }
            val target = File(dir, urlName + ext)
            if (target.exists() && target.length() > 0) return@withContext target

            println("[ABS-DL] Downloading $absoluteUrl -> ${target.absolutePath}")
            java.net.URL(absoluteUrl).openStream().use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            }
            if (target.exists() && target.length() > 0) {
                println("[ABS-DL] OK ${target.length()} bytes")
                target
            } else {
                println("[ABS-DL] Downloaded file is empty")
                null
            }
        } catch (e: Exception) {
            println("[ABS-DL] Error: ${e.message}")
            null
        }
    }

    // ─── WebSocket Callbacks ─────────────────────────────
    init {
    // Start in loading state to allow session restore
    _authState.value = AuthState.Loading
    viewModelScope.launch {
        if (restoreSession()) {
            if (isPinSet()) {
                _needsPinVerify.value = true
            }
        } else {
            _authState.value = AuthState.Unauthenticated
        }
    }

        MedikaNetwork.onMessageReceived = { msg ->
            val msgId = msg.id
            val isDuplicate = processedMessageIds.putIfAbsent(msgId, true) != null
            if (!isDuplicate) {
                viewModelScope.launch {
                    // ── Echo dedup for outgoing messages ────────────────────────
                    // The server assigns a brand-new id + timestamp when it echoes our
                    // own outgoing message back to us. We already inserted a local row
                    // with sendStatus="sending"/"sent" and possibly the local file path.
                    // Detect that case by looking for an existing local row by:
                    //   - fileUrl + senderId  (for voice/image/video)
                    //   - text + senderId + consultationId  (for text)
                    // and SKIP the insert to avoid duplicate bubbles + lost localFilePath.
                    val myId = currentServerUserId
                    val isOwnEcho = msg.senderId == myId
                    if (isOwnEcho) {
                        val existing = repository.getMessagesForConsultationOnce(msg.consultationId)
                        val match = if (!msg.fileUrl.isNullOrBlank()) {
                            existing.firstOrNull { it.fileUrl == msg.fileUrl && it.senderId == myId }
                        } else if (msg.text.isNotBlank()) {
                            // Match by text + senderId + recent timestamp window (60s)
                            val now = System.currentTimeMillis()
                            existing.firstOrNull {
                                it.senderId == myId &&
                                it.text == msg.text &&
                                it.fileUrl.isNullOrBlank() &&
                                kotlin.math.abs(it.timestamp - msg.timestamp) < 60_000L
                            }
                        } else null

                        if (match != null) {
                            // Already have a local row for this outgoing message — just
                            // make sure status is "sent" (in case the upload confirmation
                            // raced) and the server fileUrl is recorded.
                            if (match.sendStatus != "sent") {
                                repository.updateMessageStatus(match.id, "sent", msg.fileUrl ?: match.fileUrl, match.localFilePath)
                            }
                            println("[ECHO] Skipping duplicate insert for own msg (id=${match.id}, type=${msg.messageType})")
                            return@launch
                        }
                    }

                    val entity = MessageEntity(
                        consultationId = msg.consultationId,
                        senderId = msg.senderId,
                        senderName = msg.senderName,
                        text = msg.text,
                        timestamp = msg.timestamp,
                        messageType = msg.messageType,
                        fileUrl = msg.fileUrl,
                        duration = msg.duration,
                        fileSize = msg.fileSize,
                        // Incoming voice/image/video: mark as "sent" (peer sent it
                        // successfully) and start with no local copy. The auto-download
                        // below will fill in localFilePath.
                        sendStatus = if (msg.messageType != "text") "sent" else null
                    )
                    repository.insertMessage(entity)

                    // Auto-download received media into the per-consultation folder so
                    // the bubble can play/display offline.
                    val mt = msg.messageType
                    val fu = msg.fileUrl
                    if (!fu.isNullOrBlank() && (mt == "voice" || mt == "image" || mt == "video")) {
                        launch(Dispatchers.IO) {
                            val local = downloadMediaToLocal(msg.consultationId, fu)
                            if (local != null) {
                                // We need the row id; fetch by consultationId+timestamp+senderId.
                                val row = repository.getMessagesForConsultationOnce(msg.consultationId)
                                    .firstOrNull { it.timestamp == msg.timestamp && it.senderId == msg.senderId && it.fileUrl == fu }
                                if (row != null) {
                                    repository.updateMessageLocalFile(row.id, local.absolutePath, local.length())
                                    println("[MEDIA-DL] Local path saved for msg ${row.id}")
                                }
                            }
                        }
                    }
                }
                _isTyping.value = false
            }
        }

        MedikaNetwork.onTypingReceived = { typing ->
            val currentAuth = _authState.value
            val myId = when (currentAuth) {
                is AuthState.PatientAuthenticated -> currentAuth.serverUser.id
                is AuthState.DoctorAuthenticated -> currentAuth.serverUser.id
                else -> null
            }
            if (typing.senderId != myId && typing.consultationId == _activeConsultationId.value) {
                _isTyping.value = typing.isTyping
            }
        }

        MedikaNetwork.onNewConsultation = { newC ->
            viewModelScope.launch {
                println("[SYNC] Received new consultation via WS: ${newC.id}")
                fetchAndSaveConsultation(newC.id)
            }
        }

        MedikaNetwork.onConsultationUpdated = { updated ->
            viewModelScope.launch {
                println("[SYNC] Consultation ${updated.id} updated (status=${updated.status}), re-fetching consultation")
                // Always re-fetch the consultation metadata (status, doctor, etc.)
                fetchAndSaveConsultation(updated.id)
                // Re-fetch messages ONLY when the consultation just transitioned
                // to EN_COURS (doctor accepted) — this picks up the system
                // welcome message. We don't re-fetch on every status update
                // because that causes UI flicker (the WebSocket already pushes
                // new messages in real time).
                val activeId = _activeConsultationId.value
                if (activeId == updated.id && updated.status == "EN_COURS") {
                    // Give the server a moment to insert the system message
                    kotlinx.coroutines.delay(500)
                    fetchAndSaveMessages(updated.id)
                }
            }
        }

        MedikaNetwork.onConnectionChanged = { connected ->
            _wsConnected.value = connected
            if (connected && _authState.value !is AuthState.Unauthenticated) {
                // On reconnect, sync the consultation list only. Messages for
                // the active consultation will arrive via the WS catch-up
                // mechanism (server sends recent messages on connect).
                syncConsultationListOnly()
            }
        }

        // ─── Call event callbacks (reject / end / accept via WS) ───
        MedikaNetwork.onCallRejected = { consultationId ->
            com.example.CrashLogger.log("[CALL-WS] Call REJECTED for $consultationId")
            // If the caller is currently in CallActivity, finish it
            if (_activeCall.value?.consultationId == consultationId) {
                _activeCall.value = null
                currentRoomName = null
                // Send a broadcast to close any open CallActivity
                val appCtx = getApplication<android.app.Application>()
                appCtx.sendBroadcast(android.content.Intent("com.example.ACTION_CALL_ENDED").apply {
                    putExtra("reason", "rejected")
                    putExtra("consultationId", consultationId)
                })
                // Also send ZIM signal for redundancy
                try {
                    val peerId = getPeerUserIdForConsultation(consultationId, currentServerUserId ?: "")
                    if (peerId != null) {
                        ZegoChatManager.sendCallRejectSignal(peerId, consultationId)
                    }
                } catch (_: Exception) {}
            }
            // Insert system message
            viewModelScope.launch {
                repository.insertMessage(
                    com.example.data.db.MessageEntity(
                        consultationId = consultationId,
                        senderId = "system",
                        senderName = "Systeme",
                        text = "Appel rejeté par le destinataire."
                    )
                )
            }
        }

        MedikaNetwork.onCallEnded = { consultationId ->
            com.example.CrashLogger.log("[CALL-WS] Call ENDED for $consultationId")
            if (_activeCall.value?.consultationId == consultationId) {
                _activeCall.value = null
                currentRoomName = null
                val appCtx = getApplication<android.app.Application>()
                appCtx.sendBroadcast(android.content.Intent("com.example.ACTION_CALL_ENDED").apply {
                    putExtra("reason", "ended")
                    putExtra("consultationId", consultationId)
                })
            }
        }

        MedikaNetwork.onCallAccepted = { consultationId, from ->
            com.example.CrashLogger.log("[CALL-WS] Call ACCEPTED for $consultationId by $from")
            // Insert system message
            viewModelScope.launch {
                repository.insertMessage(
                    com.example.data.db.MessageEntity(
                        consultationId = consultationId,
                        senderId = "system",
                        senderName = "Systeme",
                        text = "Appel accepté."
                    )
                )
            }
        }

        // ─── ZIM (ZegoChat) message receiver ─────────────────────────────
        // Replaces the WebSocket for chat. ZIM delivers messages in real time
        // via its own signaling servers. Media files are hosted on Zego's CDN.
        ZegoChatManager.onMessageReceived = { zimMsg ->
            viewModelScope.launch {
                handleZimIncomingMessage(zimMsg)
            }
        }
        ZegoChatManager.onConnectionChanged = { connected ->
            // ZIM connection state — we don't expose this separately, the WS
            // indicator still reflects the main WebSocket state.
            println("[ZIM] Connection: $connected")
        }

        // ─── Call events via main WebSocket ─────────────────
        MedikaNetwork.onIncomingCall = { event ->
            println("[CALL] Incoming call from ${event.fromName} (${event.callType})")
            _incomingCall.value = event
        }

        MedikaNetwork.onCallAccepted = { consultationId, from ->
            println("[CALL] Call accepted in $consultationId by $from")
        }

        MedikaNetwork.onCallRejected = { consultationId ->
            println("[CALL] Call rejected in $consultationId")
            val current = _activeCall.value
            if (current != null && current.consultationId == consultationId) {
                cleanupCall()
            }
        }

        MedikaNetwork.onCallEnded = { consultationId ->
            println("[CALL] Call ended by peer in $consultationId")
            val current = _activeCall.value
            if (current != null && current.consultationId == consultationId) {
                cleanupCall()
            }
        }

        viewModelScope.launch {
            repository.initializeDoctorsIfEmpty()
        }
    }

    // ─── Server Sync Functions ────────────────────────────

    private fun serverMapToConsultationEntity(map: Map<String, Any?>): ConsultationEntity {
        return ConsultationEntity(
            id = map["id"] as? String ?: "",
            patientName = map["patient_name"] as? String ?: "",
            patientAge = (map["patient_age"] as? Number)?.toInt() ?: 0,
            description = map["description"] as? String ?: "",
            specialtyNeeded = map["specialty_needed"] as? String ?: "",
            urgencyLevel = map["urgency_level"] as? String ?: "Moyenne",
            aiSummary = map["ai_summary"] as? String ?: "",
            aiExplanation = map["ai_explanation"] as? String ?: "",
            doctorId = map["doctor_id"] as? String,
            status = map["status"] as? String ?: "RECHERCHE_MEDECIN",
            timestamp = (map["created_at"] as? Number)?.toLong()?.let {
                if (it < 1_000_000_000_000L) it * 1000L else it
            } ?: System.currentTimeMillis(),
            prescription = map["prescription"] as? String,
            patientId = map["patient_id"] as? String
        )
    }

    /**
     * Get the peer's user ID for the active consultation (used as the ZIM
     * conversation ID for peer-to-peer chat).
     */
    private fun getPeerUserIdForConsultation(consultationId: String, senderId: String): String? {
        // Try the active consultation first
        val active = activeConsultation.value
        if (active?.id == consultationId) {
            val myId = currentServerUserId
            return when {
                active.patientId == myId -> active.doctorId
                active.doctorId == myId -> active.patientId
                else -> active.doctorId ?: active.patientId
            }
        }
        return null
    }

    /**
     * Handle an incoming ZIM message: insert it into the local Room DB so the
     * chat UI shows it. If it's a media message, kick off a background download
     * into the per-consultation folder.
     */
    private suspend fun handleZimIncomingMessage(zimMsg: ZimIncomingMessage) {
        val myId = currentServerUserId
        // Skip our own messages
        if (zimMsg.senderId == myId) return

        // ─── Call signal detection (ZIM-based call signaling) ─────
        // If the message text is a JSON with type=call_signal, handle it
        // as a call invitation instead of a chat message.
        if (zimMsg.text.startsWith("{\"type\":\"call_signal\"") ||
            zimMsg.text.contains("\"callType\"")) {
            try {
                val json = org.json.JSONObject(zimMsg.text)
                if (json.optString("type") == "call_signal") {
                    val roomId = json.getString("roomId")
                    val callType = json.getString("callType")
                    val callerName = json.getString("callerName")

                    // ── Stale signal protection ──
                    // ZIM replays undelivered messages on reconnect. If this call_signal
                    // is older than 45 seconds, the call is long over — ignore it.
                    val signalAge = System.currentTimeMillis() - zimMsg.timestamp
                    if (signalAge > CALL_SIGNAL_MAX_AGE_MS) {
                        com.example.CrashLogger.log("[CALL-SIGNAL] STALE (age=${signalAge/1000}s, max=${CALL_SIGNAL_MAX_AGE_MS/1000}s) — ignoring call from ${zimMsg.senderId} room=$roomId")
                        return
                    }
                    // Also deduplicate: if we already saw this exact roomId recently, skip
                    val now = System.currentTimeMillis()
                    val lastSeen = processedCallSignals[roomId]
                    if (lastSeen != null && (now - lastSeen) < 60_000L) {
                        com.example.CrashLogger.log("[CALL-SIGNAL] DUPLICATE (last seen ${(now - lastSeen)/1000}s ago) — ignoring call room=$roomId")
                        return
                    }
                    processedCallSignals[roomId] = now

                    com.example.CrashLogger.log("[CALL-SIGNAL] Received: roomId=$roomId type=$callType from=${zimMsg.senderId}")
                    // Get application context to start CallActivity
                    val appContext = getApplication<Application>()
                    onIncomingCallSignal(roomId, callType, callerName, zimMsg.senderId, appContext)
                    return  // Don't insert this as a chat message
                }
            } catch (e: Exception) {
                // Not valid JSON or not a call signal — fall through to normal message handling
            }

            // ─── Call reject signal detection ─────────
            if (zimMsg.text.contains("call_reject")) {
                try {
                    val json = org.json.JSONObject(zimMsg.text)
                    if (json.optString("type") == "call_reject") {
                        val roomId = json.getString("roomId")
                        com.example.CrashLogger.log("[CALL-SIGNAL] Received call_reject for room=$roomId from=${zimMsg.senderId}")
                        // Close any open CallActivity for this room
                        if (_activeCall.value?.consultationId == roomId) {
                            _activeCall.value = null
                            currentRoomName = null
                            val appCtx = getApplication<android.app.Application>()
                            appCtx.sendBroadcast(android.content.Intent("com.example.ACTION_CALL_ENDED").apply {
                                putExtra("reason", "rejected")
                                putExtra("consultationId", roomId)
                            })
                        }
                        // Insert system message
                        repository.insertMessage(
                            com.example.data.db.MessageEntity(
                                consultationId = roomId,
                                senderId = "system",
                                senderName = "Systeme",
                                text = "Appel rejeté."
                            )
                        )
                        return  // Don't process as chat message
                    }
                } catch (_: Exception) {}
            }
        }


        val consultationId = zimMsg.consultationId
        if (consultationId.isBlank()) {
            println("[ZIM-RX] Received message with no consultationId — skipping")
            return
        }

        // Dedup by ZIM message ID + senderId
        val dedupKey = "zim_${zimMsg.zimMessage.messageID}_${zimMsg.senderId}"
        if (processedMessageIds.putIfAbsent(dedupKey.hashCode().toLong(), true) != null) {
            return  // already processed
        }

        // Insert into Room DB
        val entity = MessageEntity(
            consultationId = consultationId,
            senderId = zimMsg.senderId,
            senderName = zimMsg.senderName,
            text = zimMsg.text,
            timestamp = zimMsg.timestamp,
            messageType = zimMsg.messageType,
            fileUrl = zimMsg.fileUrl,
            duration = zimMsg.duration,
            fileSize = zimMsg.fileSize,
            localFilePath = null,
            sendStatus = if (zimMsg.messageType != "text") "sent" else null
        )
        repository.insertMessage(entity)
        println("[ZIM-RX] Inserted ${zimMsg.messageType} msg from ${zimMsg.senderId} for $consultationId")

        // Auto-download media into the per-consultation folder
        if (zimMsg.messageType != "text" && zimMsg.fileUrl != null) {
            val dir = medikaMediaDir(consultationId)
            // Strip query parameters from ZIM CDN URL for a valid filename
            val rawName = zimMsg.fileUrl.substringAfterLast('/').ifBlank { "zim_${zimMsg.zimMessage.messageID}" }
            val fileName = rawName.substringBefore('?').ifBlank { "zim_${zimMsg.zimMessage.messageID}" }
            val targetPath = java.io.File(dir, fileName).absolutePath

            viewModelScope.launch(Dispatchers.IO) {
                ZegoChatManager.downloadMediaFile(zimMsg.zimMessage, targetPath) { success, localPath, error ->
                    if (success && localPath != null) {
                        viewModelScope.launch {
                            // Find the row we just inserted and update its localFilePath
                            val row = repository.getMessagesForConsultationOnce(consultationId)
                                .firstOrNull { it.timestamp == zimMsg.timestamp && it.senderId == zimMsg.senderId }
                            if (row != null) {
                                repository.updateMessageLocalFile(row.id, localPath, null)
                                println("[ZIM-DL] Local path saved for msg ${row.id}")
                            }
                        }
                    } else {
                        println("[ZIM-DL] Download failed: $error")
                    }
                }
            }
        }
    }

    private suspend fun fetchAndSaveConsultation(consultationId: String) {
        val token = authToken ?: return
        try {
            val serverMap = MedikaNetwork.api.getConsultation(token, consultationId)
            if (serverMap != null) {
                val entity = serverMapToConsultationEntity(serverMap)
                val existing = repository.getConsultationById(entity.id)
                if (existing != null) {
                    repository.updateConsultation(entity)
                } else {
                    repository.insertConsultation(entity)
                }
                println("[SYNC] Saved consultation ${entity.id} (${entity.status}) to local DB")
            }
        } catch (e: Exception) {
            println("[SYNC] Error fetching consultation ${consultationId}: ${e.message}")
        }
    }

    private suspend fun fetchAndSaveMessages(consultationId: String) {
        val token = authToken ?: return
        try {
            val serverMessages = MedikaNetwork.api.getMessages(token, consultationId)

            // ── Smart diff sync (no delete + re-insert) ──────────────────────
            // Previously this function did deleteMessagesForConsultation() then
            // re-inserted all server messages. That caused the Room Flow to emit
            // an empty list then the full list, making the UI flicker and
            // interrupting voice playback every sync cycle.
            //
            // Now we do a diff:
            //   - Existing local rows that match a server row → update in place
            //     (preserve localFilePath + sendStatus).
            //   - Server rows with no local match → insert new.
            //   - Local rows with no server match AND no sendStatus → delete
            //     (they were removed from the server).
            //   - Local rows with no server match AND sendStatus=failed/sending
            //     → KEEP (they're local-only pending messages).
            val existing = repository.getMessagesForConsultationOnce(consultationId)

            // Index existing local rows by server id (when known) and by fileUrl
            val existingById = existing.associateBy { it.id }
            val existingByFileUrl = existing
                .filter { !it.fileUrl.isNullOrBlank() }
                .associateBy { it.fileUrl to it.senderId }

            // Track which local ids get matched to a server row
            val matchedLocalIds = mutableSetOf<Int>()

            for (msg in serverMessages) {
                val serverId = msg.id.toInt()
                val prev = existingById[serverId]
                    ?: existingByFileUrl[msg.file_url to msg.sender_id]

                if (prev != null) {
                    matchedLocalIds.add(prev.id)
                    // Only update if something actually changed (avoid unnecessary
                    // Flow emissions that cause UI recomposition).
                    val newTimestamp = (msg.created_at ?: System.currentTimeMillis() / 1000) * 1000L
                    val needsUpdate = prev.text != msg.text ||
                        prev.fileUrl != msg.file_url ||
                        prev.timestamp != newTimestamp ||
                        prev.duration != msg.duration ||
                        prev.fileSize != msg.file_size ||
                        prev.messageType != (msg.message_type ?: "text")

                    if (needsUpdate) {
                        repository.insertMessage(prev.copy(
                            text = msg.text,
                            fileUrl = msg.file_url,
                            timestamp = newTimestamp,
                            duration = msg.duration,
                            fileSize = msg.file_size,
                            messageType = msg.message_type ?: "text"
                            // Preserve localFilePath + sendStatus
                        ))
                    }
                } else {
                    // New server message — insert it
                    val entity = MessageEntity(
                        id = serverId,
                        consultationId = msg.consultation_id,
                        senderId = msg.sender_id,
                        senderName = msg.sender_name,
                        text = msg.text,
                        timestamp = (msg.created_at ?: System.currentTimeMillis() / 1000) * 1000L,
                        messageType = msg.message_type ?: "text",
                        fileUrl = msg.file_url,
                        duration = msg.duration,
                        fileSize = msg.file_size,
                        localFilePath = null,
                        sendStatus = if (msg.message_type != "text") "sent" else null
                    )
                    repository.insertMessage(entity)

                    // Trigger auto-download for new media messages.
                    // Supports both server-relative URLs ("/uploads/...") and absolute URLs (ZIM CDN).
                    val mt = msg.message_type
                    val fu = msg.file_url
                    if (!fu.isNullOrBlank() && (mt == "voice" || mt == "image" || mt == "video")) {
                        viewModelScope.launch(Dispatchers.IO) {
                            val local = if (fu.startsWith("http")) {
                                // Absolute URL (ZIM CDN or similar) — download directly
                                downloadAbsoluteUrlToLocal(msg.consultation_id, fu, mt)
                            } else {
                                downloadMediaToLocal(msg.consultation_id, fu)
                            }
                            if (local != null) {
                                repository.updateMessageLocalFile(serverId, local.absolutePath, local.length())
                            }
                        }
                    }
                }
                processedMessageIds[msg.id] = true
            }

            // Delete local rows that have no server match AND are not pending.
            // IMPORTANT: only delete messages that clearly originated from the server
            // (have a server-relative fileUrl starting with "/"). ZIM-originated messages
            // (ZIM-sent, ZIM-received text/media) are NOT on the Medika server and must
            // be preserved to avoid losing them on every sync cycle.
            for (local in existing) {
                if (local.id !in matchedLocalIds) {
                    val isPending = local.sendStatus == "failed" || local.sendStatus == "sending"
                    val hasLocalFile = !local.localFilePath.isNullOrBlank()
                    // ZIM-sent messages: sendStatus="sent" but no server fileUrl
                    val isZimSent = local.sendStatus == "sent" && local.fileUrl.isNullOrBlank()
                    // ZIM-received text: sendStatus=null, no fileUrl, no local file
                    val isZimReceivedText = local.sendStatus == null && local.fileUrl.isNullOrBlank() && local.messageType == "text"
                    // ZIM CDN URL (absolute http/https) — not from Medika server
                    val hasZimCdnUrl = !local.fileUrl.isNullOrBlank() && (local.fileUrl.startsWith("http://") || local.fileUrl.startsWith("https://"))

                    if (!isPending && !hasLocalFile && !isZimSent && !isZimReceivedText && !hasZimCdnUrl) {
                        repository.deleteMessage(local.id)
                    }
                }
            }

            println("[SYNC] Synced ${serverMessages.size} messages for $consultationId (diff: ${existing.size}→${serverMessages.size})")
        } catch (e: Exception) {
            println("[SYNC] Error fetching messages for ${consultationId}: ${e.message}")
        }
    }

    fun syncConsultationsFromServer() {
        val token = authToken ?: return
        _isSyncing.value = true
        viewModelScope.launch {
            try {
                val serverConsultations = MedikaNetwork.api.getConsultations(token)
                var inserted = 0
                var updated = 0
                for (sc in serverConsultations) {
                    val entity = serverMapToConsultationEntity(sc)
                    val existing = repository.getConsultationById(entity.id)
                    if (existing != null) {
                        repository.updateConsultation(entity)
                        updated++
                    } else {
                        repository.insertConsultation(entity)
                        inserted++
                    }
                }
                println("[SYNC] Consultations synced: $inserted new, $updated updated (total: ${serverConsultations.size})")
                // Also sync messages for active consultation
                val activeId = _activeConsultationId.value
                if (activeId != null) {
                    fetchAndSaveMessages(activeId)
                }
            } catch (e: Exception) {
                println("[SYNC] Error syncing consultations: ${e.message}")
            } finally {
                _isSyncing.value = false
            }
        }
    }

    fun refreshConsultations() {
        syncConsultationsFromServer()
    }

    private fun startSyncPolling() {
        syncPollingJob?.cancel()
        syncPollingJob = viewModelScope.launch {
            while (true) {
                delay(60_000) // poll every 60s (down from 30s) — WebSocket handles real-time
                if (authToken != null) {
                    // Only sync the consultation LIST in the background.
                    // Do NOT re-fetch messages for the active consultation here —
                    // the WebSocket delivers new messages in real time, and
                    // re-fetching causes UI flicker / voice playback interruption.
                    // Message re-sync only happens when the user opens a
                    // consultation (setActiveConsultation) or when the WS
                    // reconnects.
                    println("[SYNC] Periodic poll - syncing consultation list only")
                    syncConsultationListOnly()
                }
            }
        }
    }

    /**
     * Sync only the consultation list (not messages). This avoids the UI flicker
     * that happened when syncConsultationsFromServer() called fetchAndSaveMessages()
     * for the active consultation on every 30s poll.
     */
    private fun syncConsultationListOnly() {
        val token = authToken ?: return
        viewModelScope.launch {
            try {
                val serverConsultations = MedikaNetwork.api.getConsultations(token)
                for (sc in serverConsultations) {
                    val entity = serverMapToConsultationEntity(sc)
                    val existing = repository.getConsultationById(entity.id)
                    if (existing != null && existing.status == entity.status && existing.doctorId == entity.doctorId) {
                        // No change — skip to avoid unnecessary DB writes
                        continue
                    }
                    if (existing != null) {
                        repository.updateConsultation(entity)
                    } else {
                        repository.insertConsultation(entity)
                    }
                }
            } catch (e: Exception) {
                println("[SYNC] Error syncing consultation list: ${e.message}")
            }
        }
    }

    // ─── Session Persistence Helpers ──────────────────────────

    /** Save the current auth session to SharedPreferences so the user stays logged in across app restarts. */
    private fun saveSession(token: String, user: UserDto) {
        prefs.edit()
            .putString("auth_token", token)
            .putString("user_id", user.id)
            .putString("user_name", user.name)
            .putString("user_role", user.role)
            .putString("user_username", user.username)
            .putString("user_email", user.email ?: "")
            .putString("user_phone", user.phone ?: "")
            .putInt("user_age", user.age ?: 0)
            .putString("user_gender", user.gender ?: "")
            .putString("user_specialty", user.specialty ?: "")
            .putString("user_license_number", user.license_number ?: "")
            .putString("user_location", user.location ?: "")
            .putString("user_hospital", user.hospital ?: "")
            .putString("user_biography", user.biography ?: "")
            .putString("user_avatar_url", user.avatar_url ?: "")
            .putFloat("user_rating", (user.rating ?: 4.9).toFloat())
            .putInt("user_is_available", user.is_available ?: 1)
            .putLong("session_saved_at", System.currentTimeMillis())
            .apply()
        com.example.CrashLogger.log("[SESSION] Saved session for user ${user.id} (${user.role})")
    }

    /** Try to restore a previously saved session. Returns true if session was restored. */
    private suspend fun restoreSession(): Boolean {
        val token = prefs.getString("auth_token", null) ?: return false
        val userId = prefs.getString("user_id", null) ?: return false
        val role = prefs.getString("user_role", null) ?: return false
        val userName = prefs.getString("user_name", "") ?: ""
        val userEmail = prefs.getString("user_email", "") ?: ""
        val userPhone = prefs.getString("user_phone", "") ?: ""
        val userAge = prefs.getInt("user_age", 0)
        val userGender = prefs.getString("user_gender", "") ?: ""
        val userUsername = prefs.getString("user_username", "") ?: ""
        val userSpecialty = prefs.getString("user_specialty", "") ?: ""
        val userLicenseNumber = prefs.getString("user_license_number", "") ?: ""
        val userLocation = prefs.getString("user_location", "") ?: ""
        val userHospital = prefs.getString("user_hospital", "") ?: ""
        val userBiography = prefs.getString("user_biography", "") ?: ""
        val userAvatarUrl = prefs.getString("user_avatar_url", "") ?: ""
        val userRating = prefs.getFloat("user_rating", 4.9f).toDouble()
        val userIsAvailable = prefs.getInt("user_is_available", 1)

        // Reconstruct the UserDto
        val serverUser = UserDto(
            id = userId,
            username = userUsername,
            role = role,
            name = userName,
            email = userEmail.ifBlank { null },
            phone = userPhone.ifBlank { null },
            age = userAge,
            gender = userGender.ifBlank { null },
            specialty = userSpecialty.ifBlank { null },
            license_number = userLicenseNumber.ifBlank { null },
            location = userLocation.ifBlank { null },
            hospital = userHospital.ifBlank { null },
            biography = userBiography.ifBlank { null },
            avatar_url = userAvatarUrl.ifBlank { null },
            rating = userRating,
            is_available = userIsAvailable
        )

        // Restore in-memory state
        authToken = "Bearer $token"
        currentServerUserId = userId
        currentUserName = userName
        MedikaNetwork.authToken = "Bearer $token"

        // Restore auth state based on role
        when (role) {
            "patient" -> {
                val profile = PatientProfileEntity(
                    id = "current_patient",
                    name = userName,
                    email = userEmail,
                    phone = userPhone,
                    age = userAge,
                    gender = userGender.ifBlank { "Homme" }
                )
                repository.savePatientProfile(profile)
                _authState.value = AuthState.PatientAuthenticated(profile, serverUser)
            }
            "doctor" -> {
                val doctor = DoctorEntity(
                    id = userId,
                    name = userName,
                    specialty = userSpecialty.ifBlank { "Medecine Generale" },
                    licenseNumber = userLicenseNumber,
                    location = userLocation,
                    avatarUrl = userAvatarUrl,
                    rating = userRating,
                    isAvailable = userIsAvailable == 1,
                    hospital = userHospital,
                    biography = userBiography
                )
                repository.insertDoctors(listOf(doctor))
                _authState.value = AuthState.DoctorAuthenticated(doctor, serverUser)
            }
            "admin" -> {
                _authState.value = AuthState.AdminAuthenticated
            }
        }

        // Sync admin data if admin
        if (role == "admin") syncAdminData()

        // ── FAST PATH: auth state is already set above, UI can render now.
        //    Defer all heavy init (WS, ZEGO, ZIM) to background so the user
        //    sees the PIN/home screen instantly instead of a blank loading spinner.

        viewModelScope.launch(Dispatchers.Default) {
            com.example.CrashLogger.log("[SESSION] Background init starting...")

            // Reconnect WebSocket (non-blocking OkHttp, but do it off main)
            MedikaNetwork.connectWebSocket(userId)

            // Re-initialize ZEGO call service (loads native .so — heavy)
            try {
                ZegoCallManager.init(getApplication(), userId, userName)
                _zegoCallReady.value = ZegoCallManager.isInitialized()
                com.example.CrashLogger.log("[SESSION] ZegoCall ready in background")
            } catch (e: Throwable) {
                com.example.CrashLogger.log("[SESSION] ZegoCall re-init failed: ${e.message}")
                _zegoCallReady.value = false
            }

            // Re-initialize ZIM chat (loads native .so — heavy)
            try {
                val instanceCreated = ZegoChatManager.init(getApplication(), userId, userName)
                ZegoChatManager.onLoginResult = { success, errorCode, errorMsg ->
                    viewModelScope.launch {
                        _zegoChatReady.value = success
                        if (!success) {
                            com.example.CrashLogger.log("[SESSION] ZegoChat re-login failed: $errorCode $errorMsg")
                        }
                    }
                }
                _zegoChatReady.value = instanceCreated
                com.example.CrashLogger.log("[SESSION] ZegoChat init done in background")
            } catch (e: Throwable) {
                com.example.CrashLogger.log("[SESSION] ZegoChat re-init failed: ${e.message}")
                _zegoChatReady.value = false
            }

            // Sync consultations from server (network I/O)
            syncConsultationsFromServer()
            startSyncPolling()
            processedMessageIds.clear()

            com.example.CrashLogger.log("[SESSION] Background init complete for user $userId ($role)")
        }

        return true
    }

    /** Clear the persisted session (called on logout). */
    private fun clearSession() {
        prefs.edit().clear().apply()
        com.example.CrashLogger.log("[SESSION] Cleared saved session")
    }


    // ─── PIN Methods ─────────────────────────────────

    /** Check if a PIN has been set in SharedPreferences. */
    fun isPinSet(): Boolean {
        return prefs.getString("pin_hash", null) != null
    }

    /** Hash a 4-digit PIN using SHA-256 with a static salt. */
    private fun hashPin(pin: String): String {
        val salted = "medika_pin_" + pin + "_secure_salt_2024"
        val digest = MessageDigest.getInstance("SHA-256").digest(salted.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    /** Save a new PIN (hashed). Called from PinSetupScreen. */
    fun setPin(pin: String) {
        val hash = hashPin(pin)
        prefs.edit().putString("pin_hash", hash).apply()
        _needsPinSetup.value = false
        com.example.CrashLogger.log("[PIN] PIN configured successfully")
    }

    /** Verify a PIN against the stored hash. Returns true if correct. */
    fun verifyPin(pin: String): Boolean {
        val storedHash = prefs.getString("pin_hash", null)
        if (storedHash == null) {
            _needsPinVerify.value = false
            return true
        }
        val inputHash = hashPin(pin)
        if (inputHash == storedHash) {
            _needsPinVerify.value = false
            com.example.CrashLogger.log("[PIN] PIN verified successfully")
            return true
        } else {
            _pinVerifyError.value = "incorrect"
            com.example.CrashLogger.log("[PIN] PIN verification failed")
            return false
        }
    }

    /** Consume the PIN error (called by UI after displaying it). */
    fun consumePinError() {
        _pinVerifyError.value = null
    }

    /** Called when user skips PIN setup. */
    fun skipPinSetup() {
        _needsPinSetup.value = false
        com.example.CrashLogger.log("[PIN] User skipped PIN setup")
    }

    // ─── CHANGE PASSWORD ──────────────────────────────

    fun changePassword(oldPassword: String, newPassword: String) {
        viewModelScope.launch {
            try {
                val token = authToken ?: return@launch
                // For now, re-login with the new password to verify it works
                val response = MedikaNetwork.api.login(LoginRequest(
                    username = currentServerUserId ?: "",
                    password = oldPassword
                ))
                // Old password is correct, now update
                // Note: The server may not have a dedicated change-password endpoint yet.
                // We save the session with the new token.
                authToken = "Bearer ${response.token}"
                MedikaNetwork.authToken = "Bearer ${response.token}"
                _uploadError.value = null
                com.example.CrashLogger.log("[PROFILE] Password verification OK")
            } catch (e: Exception) {
                _uploadError.value = "Ancien mot de passe incorrect"
                com.example.CrashLogger.log("[PROFILE] Password change failed: ${e.message}")
            }
        }
    }

    // ─── LOGIN ─────────────────────────────────

    fun loginWithCredentials(username: String, password: String) {
        if (username.isBlank() || password.isBlank()) {
            _loginError.value = "Veuillez remplir tous les champs"
            return
        }
        _authState.value = AuthState.Loading
        _loginError.value = null

                // Same IO dispatcher fix as registerPatient
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val response = MedikaNetwork.api.login(LoginRequest(username, password))
                authToken = "Bearer ${response.token}"
                currentServerUserId = response.user.id
                currentUserName = response.user.name
                MedikaNetwork.authToken = "Bearer ${response.token}"
                MedikaNetwork.connectWebSocket(response.user.id)

                // UI state updates on Main thread
                withContext(Dispatchers.Main) {
                    if (!isPinSet()) _needsPinSetup.value = true
                    handleAuthResponse(response)
                    saveSession(response.token, response.user)
                }

                // ZEGO/ZIM init on background thread
                viewModelScope.launch(Dispatchers.Default) {
                    try {
                        ZegoCallManager.init(getApplication(), response.user.id, response.user.name)
                        _zegoCallReady.value = ZegoCallManager.isInitialized()
                    } catch (e: Throwable) {
                        _zegoCallReady.value = false
                    }
                    try {
                        val ok = ZegoChatManager.init(getApplication(), response.user.id, response.user.name)
                        ZegoChatManager.onLoginResult = { success, code, msg ->
                            viewModelScope.launch { _zegoChatReady.value = success
                                if (!success) _uploadError.value = "Echec ZIM ($code): $msg" } }
                        _zegoChatReady.value = ok
                    } catch (e: Throwable) {
                        _zegoCallReady.value = false
                    }
                }
            } catch (e: java.lang.StackOverflowError) {
                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Unauthenticated
                    _loginError.value = "Erreur de pile memoire. Reessayez."
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Unauthenticated
                    _loginError.value = "Nom d'utilisateur ou mot de passe incorrect"
                }
            }
        }
    }

    // ─── REGISTER ────────────────────────────

    fun registerPatient(username: String, password: String, name: String, email: String, phone: String, age: Int, gender: String) {
        if (username.isBlank() || password.isBlank() || name.isBlank()) {
            _registerError.value = "Veuillez remplir le nom d’utilisateur, le mot de passe et le nom complet"
            return
        }
        _authState.value = AuthState.Loading
        _registerError.value = null
        com.example.CrashLogger.log("[REGISTER] Starting registration for username=" + username)

                // CRITICAL FIX: Dispatchers.IO gives a fresh, shallow stack.
        // Default Dispatchers.Main.immediate continues on the deep Compose
        // composition stack — Moshi reflection on top overflows 8MB stack.
                // v3: Raw Thread guarantees a completely fresh 512KB stack.
        // Even Dispatchers.IO can inherit deep coroutine continuation stacks.
        _registerError.value = null
        Thread({
            try {
                com.example.CrashLogger.log("[REGISTER-v3] Starting on raw thread")
                val response = kotlinx.coroutines.runBlocking {
                    MedikaNetwork.api.register(
                        RegisterRequest(username=username, password=password,
                            name=name, email=email, phone=phone, age=age, gender=gender))
                }
                com.example.CrashLogger.log("[REGISTER-v3] API OK: " + response.user.id)
                authToken = "Bearer " + response.token
                currentServerUserId = response.user.id
                currentUserName = response.user.name
                MedikaNetwork.authToken = "Bearer " + response.token
                try { MedikaNetwork.connectWebSocket(response.user.id) } catch (_: Throwable) {}

                // Post UI updates to Main thread
                val handler = android.os.Handler(android.os.Looper.getMainLooper())
                handler.post({
                    if (!isPinSet()) _needsPinSetup.value = true
                    viewModelScope.launch {
                        handleAuthResponse(response)
                        saveSession(response.token, response.user)
                    }
                    viewModelScope.launch(Dispatchers.Default) {
                        try { ZegoCallManager.init(getApplication(), response.user.id, response.user.name)
                            _zegoCallReady.value = ZegoCallManager.isInitialized()
                        } catch (_: Throwable) { _zegoCallReady.value = false }
                        try { val ok = ZegoChatManager.init(getApplication(), response.user.id, response.user.name)
                            ZegoChatManager.onLoginResult = { s, c, m ->
                                viewModelScope.launch { _zegoCallReady.value = s
                                    if (!s) _uploadError.value = "Echec ZIM ($c): $m" } }
                            _zegoChatReady.value = ok
                        } catch (_: Throwable) { _zegoCallReady.value = false }
                    }
                })
            } catch (e: java.lang.StackOverflowError) {
                com.example.CrashLogger.log("[REGISTER-v3] STACK_OVERFLOW: " + e.message)
                android.os.Handler(android.os.Looper.getMainLooper()).post({
                    _authState.value = AuthState.Unauthenticated
                    _registerError.value = "[v3] Erreur de pile. Reessayez."
                })
            } catch (e: Throwable) {
                com.example.CrashLogger.log("[REGISTER-v3] " + e.javaClass.simpleName + ": " + e.message)
                android.os.Handler(android.os.Looper.getMainLooper()).post({
                    _authState.value = AuthState.Unauthenticated
                    _registerError.value = "[v3] Erreur: " + (e.localizedMessage ?: "inconnue")
                })
            }
        }, "RegisterThread").start()

    }

    private suspend fun handleAuthResponse(response: LoginResponse) {
        when (response.user.role) {
            "patient" -> {
                val profile = PatientProfileEntity(
                    id = "current_patient",
                    name = response.user.name,
                    email = response.user.email ?: "",
                    phone = response.user.phone ?: "",
                    age = response.user.age ?: 0,
                    gender = response.user.gender ?: "Homme"
                )
                repository.savePatientProfile(profile)
                _authState.value = AuthState.PatientAuthenticated(profile, response.user)
            }
            "doctor" -> {
                val doctor = DoctorEntity(
                    id = response.user.id,
                    name = response.user.name,
                    specialty = response.user.specialty ?: "Medecine Generale",
                    licenseNumber = response.user.license_number ?: "",
                    location = response.user.location ?: "",
                    avatarUrl = response.user.avatar_url ?: "",
                    rating = response.user.rating ?: 4.9,
                    isAvailable = (response.user.is_available ?: 1) == 1,
                    hospital = response.user.hospital ?: "",
                    biography = response.user.biography ?: ""
                )
                repository.insertDoctors(listOf(doctor))
                _authState.value = AuthState.DoctorAuthenticated(doctor, response.user)
            }
            "admin" -> {
                _authState.value = AuthState.AdminAuthenticated
            }
        }

        processedMessageIds.clear()
        if (response.user.role == "admin") {
            syncAdminData()
        } else {
            syncConsultationsFromServer()
        }
        startSyncPolling()
    }

    fun updateDoctorProfile(name: String, email: String, phone: String) {
        viewModelScope.launch {
            try {
                val token = authToken ?: return@launch
                MedikaNetwork.api.updateProfile(token, UpdateProfileRequest(name = name, email = email, phone = phone))
                com.example.CrashLogger.log("[PROFILE] Doctor profile updated")
            } catch (e: Exception) {
                com.example.CrashLogger.log("[PROFILE] Update failed: \${e.message}")
            }
        }
    }

    fun clearLoginError() { _loginError.value = null }
    fun clearRegisterError() { _registerError.value = null }

    // ─── LOGOUT ─────────────────────────────────

    fun logout() {
        clearSession()
        MedikaNetwork.disconnectWebSocket()
        cleanupCall()
        ZegoCallManager.uninit()
        ZegoChatManager.uninit()
        ZegoChatManager.onLoginResult = null
        _zegoCallReady.value = false
        _zegoChatReady.value = false
        authToken = null
        currentServerUserId = null
        currentUserName = null
        _activeConsultationId.value = null
        _authState.value = AuthState.Unauthenticated
        _needsPinSetup.value = false
        _needsPinVerify.value = false
        _pinVerifyError.value = null
        resetIntake()
        processedMessageIds.clear()
        syncPollingJob?.cancel()
        syncPollingJob = null
    }

    // ─── SEND MESSAGE (local-first via ZIM) ──────────────────────────────
    // Sends text through ZEGOCLOUD ZIM (real-time chat). Falls back to the
    // old WebSocket transport if ZIM is not initialized.

    fun sendChatMessage(text: String, senderId: String, senderName: String) {
        val consultationId = _activeConsultationId.value ?: return
        if (text.isBlank()) return

        viewModelScope.launch {
            val ts = System.currentTimeMillis()
            val entity = MessageEntity(
                consultationId = consultationId,
                senderId = senderId,
                senderName = senderName,
                text = text,
                timestamp = ts,
                messageType = "text",
                fileUrl = null,
                duration = null,
                fileSize = null,
                localFilePath = null,
                sendStatus = "sending"
            )
            repository.insertMessage(entity)
            println("[TEXT] Inserted local row (ts=$ts), sending via ZIM...")

            val peerUserId = getPeerUserIdForConsultation(consultationId, senderId)
            if (peerUserId == null) {
                println("[TEXT] No peer user ID found — cannot send via ZIM")
                val row = repository.getMessagesForConsultationOnce(consultationId)
                    .firstOrNull { it.timestamp == ts && it.senderId == senderId && it.text == text }
                row?.let { repository.updateMessageStatus(it.id, "failed", null, null) }
                _uploadError.value = "Impossible de trouver le destinataire"
                return@launch
            }

            // Try ZIM first, fall back to WebSocket if ZIM is not ready
            var zimSent = false
            withContext(Dispatchers.IO) {
                zimSent = ZegoChatManager.isLoggedIn()
                if (zimSent) {
                    ZegoChatManager.sendTextMessage(text, peerUserId, consultationId, senderName) { success, _, errMsg ->
                        viewModelScope.launch {
                            val row = repository.getMessagesForConsultationOnce(consultationId)
                                .firstOrNull { it.timestamp == ts && it.senderId == senderId && it.text == text }
                            if (row != null) {
                                if (success) {
                                    repository.updateMessageStatus(row.id, "sent", null, null)
                                    println("[TEXT] ZIM send OK for row ${row.id}")
                                } else {
                                    // ZIM send failed — try WebSocket fallback
                                    println("[TEXT] ZIM send FAILED for row ${row.id}: $errMsg — trying WS fallback")
                                    val wsOk = MedikaNetwork.sendMessage(consultationId, senderId, senderName, text, "text")
                                    if (wsOk) {
                                        repository.updateMessageStatus(row.id, "sent", null, null)
                                    } else {
                                        repository.updateMessageStatus(row.id, "failed", null, null)
                                        _uploadError.value = "Echec envoi: ${errMsg ?: "erreur inconnue"}"
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // WebSocket fallback when ZIM is not logged in
            if (!zimSent) {
                println("[TEXT] ZIM not logged in — sending via WebSocket fallback")
                val wsOk = MedikaNetwork.sendMessage(consultationId, senderId, senderName, text, "text")
                val row = repository.getMessagesForConsultationOnce(consultationId)
                    .firstOrNull { it.timestamp == ts && it.senderId == senderId && it.text == text }
                if (row != null) {
                    if (wsOk) {
                        repository.updateMessageStatus(row.id, "sent", null, null)
                        println("[TEXT] WS fallback send OK for row ${row.id}")
                    } else {
                        repository.updateMessageStatus(row.id, "failed", null, null)
                        _uploadError.value = "Echec envoi: ZIM non disponible"
                    }
                }
            }
        }
    }

    /** Retry sending a text message that previously failed (via ZIM). */
    fun retrySendTextMessage(messageId: Int) {
        viewModelScope.launch {
            val msg = repository.getMessageById(messageId) ?: return@launch
            if (msg.sendStatus != "failed") return@launch
            if (msg.messageType != "text") return@launch
            val consultationId = msg.consultationId
            repository.updateMessageStatus(messageId, "sending", msg.fileUrl, msg.localFilePath)
            println("[RETRY-TEXT] Retrying msg $messageId via ZIM")

            val peerUserId = getPeerUserIdForConsultation(consultationId, msg.senderId)
            if (peerUserId == null) {
                repository.updateMessageStatus(messageId, "failed", msg.fileUrl, msg.localFilePath)
                _uploadError.value = "Impossible de trouver le destinataire"
                return@launch
            }

            withContext(Dispatchers.IO) {
                ZegoChatManager.sendTextMessage(msg.text, peerUserId, consultationId, msg.senderName) { success, _, errMsg ->
                    viewModelScope.launch {
                        if (success) {
                            repository.updateMessageStatus(messageId, "sent", msg.fileUrl, msg.localFilePath)
                            println("[RETRY-TEXT] OK msg $messageId")
                        } else {
                            repository.updateMessageStatus(messageId, "failed", msg.fileUrl, msg.localFilePath)
                            _uploadError.value = "Echec renvoi: ${errMsg ?: "erreur inconnue"}"
                            println("[RETRY-TEXT] Failed again for msg $messageId: $errMsg")
                        }
                    }
                }
            }
        }
    }

    fun sendTypingIndication() {
        val consultationId = _activeConsultationId.value ?: return
        MedikaNetwork.sendTyping(consultationId, true)
    }

    // ─── FIND DOCTORS BY CATEGORY ───────────────────────────

    fun findDoctorsByCategory(symptomText: String, category: String) {
        if (symptomText.isBlank()) return
        _intakeState.value = IntakeState.Loading

        viewModelScope.launch {
            try {
                val token = authToken ?: throw Exception("Not authenticated")
                val serverDoctors = MedikaNetwork.api.getDoctorsBySpecialty(token, category)

                val availableDoctors = serverDoctors
                    .filter { (it.is_available ?: 1) == 1 }
                    .map { dto ->
                        DoctorEntity(
                            id = dto.id,
                            name = dto.name,
                            specialty = dto.specialty ?: category,
                            licenseNumber = dto.license_number ?: "",
                            location = dto.location ?: "",
                            avatarUrl = dto.avatar_url ?: "",
                            rating = dto.rating ?: 4.5,
                            isAvailable = true,
                            hospital = dto.hospital ?: "",
                            biography = dto.biography ?: ""
                        )
                    }

                if (availableDoctors.isEmpty()) {
                    _intakeState.value = IntakeState.NoDoctors(category)
                } else {
                    _intakeState.value = IntakeState.DoctorsLoaded(availableDoctors, category)
                }
            } catch (e: Exception) {
                _intakeState.value = IntakeState.Error("Erreur de connexion: ${e.localizedMessage}")
            }
        }
    }

    fun selectDoctorAndSendRequest(doctor: DoctorEntity, symptomText: String, category: String, transactionId: String? = null, paymentAmount: Int? = null, orderId: String? = null) {
        viewModelScope.launch {
            try {
                val profile = repository.getPatientProfile() ?: PatientProfileEntity(
                    name = "Patient", email = "", phone = "", age = 0, gender = "Homme"
                )

                val token = authToken ?: return@launch
                val response = MedikaNetwork.api.createConsultation(
                    token,
                    CreateConsultationRequest(
                        description = symptomText,
                        specialtyNeeded = category,
                        urgencyLevel = "Moyenne",
                        aiSummary = "Consultation $category - $symptomText",
                        aiExplanation = "",
                        doctorId = doctor.id,
                        patientAge = profile.age,
                        transactionId = transactionId,
                        paymentAmount = paymentAmount,
                        orderId = orderId
                    )
                )

                val consultationId = response["id"] as? String ?: return@launch

                repository.insertConsultation(
                    ConsultationEntity(
                        id = consultationId,
                        patientName = profile.name,
                        patientAge = profile.age,
                        description = symptomText,
                        specialtyNeeded = category,
                        urgencyLevel = "Moyenne",
                        aiSummary = "",
                        aiExplanation = "",
                        doctorId = doctor.id,
                        status = "RECHERCHE_MEDECIN",
                        // The patient is the current user — store their server user ID
                        // so the doctor can send them ZIM messages / call invitations.
                        patientId = currentServerUserId
                    )
                )

                repository.insertMessage(
                    MessageEntity(
                        consultationId = consultationId,
                        senderId = "system",
                        senderName = "Medika",
                        text = "Demande envoyee au ${doctor.name}. En attente d'acceptation..."
                    )
                )

                _activeConsultationId.value = consultationId
                _intakeState.value = IntakeState.Idle
            } catch (e: Exception) {
                _intakeState.value = IntakeState.Error("Erreur de connexion: ${e.localizedMessage}")
            }
        }
    }

    fun resetIntake() {
        _intakeState.value = IntakeState.Idle
    }

    fun setActiveConsultation(id: String?) {
        _activeConsultationId.value = id
        if (id != null) {
            viewModelScope.launch {
                fetchAndSaveMessages(id)
            }
        }
    }

    // ─── DOCTOR ACTIONS ─────────────────────────────

    fun doctorAcceptConsultation(id: String) {
        viewModelScope.launch {
            try {
                val token = authToken ?: return@launch
                MedikaNetwork.api.acceptConsultation(token, id)
                val local = repository.getConsultationById(id)
                if (local != null) {
                    repository.updateConsultation(local.copy(status = "EN_COURS"))
                    repository.insertMessage(
                        MessageEntity(
                            consultationId = id, senderId = "system", senderName = "Systeme",
                            text = "Consultation acceptee. Le salon de discussion est ouvert."
                        )
                    )
                }
                _activeConsultationId.value = id
                delay(500)
                fetchAndSaveMessages(id)
            } catch (e: Exception) {
                println("[API] Error accepting: ${e.message}")
            }
        }
    }

    fun doctorRejectConsultation(id: String) {
        viewModelScope.launch {
            try {
                val token = authToken ?: return@launch
                MedikaNetwork.api.rejectConsultation(token, id)
                val local = repository.getConsultationById(id)
                if (local != null) {
                    repository.updateConsultation(local.copy(status = "REFUSE"))
                }
            } catch (e: Exception) {
                println("[API] Error rejecting: ${e.message}")
            }
        }
    }

    fun writePrescription(consultationId: String, prescriptionText: String) {
        viewModelScope.launch {
            try {
                val token = authToken ?: return@launch
                MedikaNetwork.api.writePrescription(token, consultationId, PrescriptionRequest(prescriptionText))
                val local = repository.getConsultationById(consultationId)
                if (local != null) {
                    repository.updateConsultation(local.copy(prescription = prescriptionText, status = "TERMINE"))
                    repository.insertMessage(
                        MessageEntity(
                            consultationId = consultationId, senderId = "system", senderName = "Systeme",
                            text = "Ordonnance redigee. Consultation clôturée."
                        )
                    )
                }
                delay(500)
                fetchAndSaveMessages(consultationId)
            } catch (e: Exception) {
                println("[API] Error writing prescription: ${e.message}")
            }
        }
    }

    fun toggleDoctorAvailability(doctorId: String, isAvailable: Boolean) {
        viewModelScope.launch {
            try {
                val token = authToken ?: return@launch
                MedikaNetwork.api.updateAvailability(token, mapOf("isAvailable" to isAvailable))
            } catch (_: Exception) {}
            repository.updateDoctorAvailability(doctorId, isAvailable)
            val currentAuth = _authState.value
            if (currentAuth is AuthState.DoctorAuthenticated && currentAuth.doctor.id == doctorId) {
                _authState.value = AuthState.DoctorAuthenticated(currentAuth.doctor.copy(isAvailable = isAvailable), currentAuth.serverUser)
            }
        }
    }

    // ─── PROFILE ────────────────────────────────────

    fun updatePatientProfile(name: String, email: String, phone: String, age: Int, gender: String, allergies: String, medications: String, history: String) {
        viewModelScope.launch {
            try {
                val token = authToken ?: return@launch
                MedikaNetwork.api.updateProfile(token, UpdateProfileRequest(name = name, email = email, phone = phone, age = age, gender = gender))
            } catch (_: Exception) {}
            val updated = PatientProfileEntity(name = name, email = email, phone = phone, age = age, gender = gender, allergies = allergies, medications = medications, history = history)
            repository.savePatientProfile(updated)
            val currentAuth = _authState.value
            if (currentAuth is AuthState.PatientAuthenticated) {
                _authState.value = AuthState.PatientAuthenticated(updated, currentAuth.serverUser)
            }
        }
    }

    // ══════════════════════════════════════════════════════
    // ─── CALLING SYSTEM (LiveKit) - DO NOT MODIFY ───────────────────────
    // ══════════════════════════════════════════════════════

    fun hasCallPermissions(context: Context, isVideo: Boolean): Boolean {
        val app = context.applicationContext
        val audioOk = ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val cameraOk = !isVideo || ContextCompat.checkSelfPermission(app, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        return audioOk && cameraOk
    }

    // ─── Outgoing Call ─────────────────────────────────

    fun startCall(consultationId: String, peerName: String, peerAvatar: String?, isVideo: Boolean) {
        if (_activeCall.value != null) {
            _activeCall.value = null
        }

        val app = getApplication<Application>()
        if (!hasCallPermissions(app, isVideo)) {
            println("[CALL] Permissions not granted, requesting...")
            pendingCallParams = arrayOf(consultationId, peerName, peerAvatar ?: "", isVideo)
            pendingCallNeedsVideo = isVideo
            _requestCallPermissions.value = true
            return
        }

        executeCall(consultationId, peerName, peerAvatar, isVideo)
    }

    fun onCallPermissionsResult(granted: Boolean) {
        _requestCallPermissions.value = false
        if (granted && pendingCallParams != null) {
            val params = pendingCallParams!!
            pendingCallParams = null
            executeCall(params[0] as String, params[1] as String, (params[2] as String).ifEmpty { null }, params[3] as Boolean)
        } else {
            pendingCallParams = null
            val current = _activeCall.value
            if (current != null) {
                viewModelScope.launch { _activeCall.value = null }
            }
        }
    }

    private fun executeCall(consultationId: String, peerName: String, peerAvatar: String?, isVideo: Boolean) {
        val myId = currentServerUserId ?: run {
            com.example.CrashLogger.log("[CALL] Not authenticated, cannot call")
            return
        }
        val myName = currentUserName ?: "User"
        val roomId = consultationId  // Use consultation ID as Agora room name

        com.example.CrashLogger.log("[CALL] Initiating ${if (isVideo) "video" else "voice"} call to $peerName (room=$roomId)")

        _activeCall.value = CallSession(
            consultationId = consultationId, peerName = peerName, peerAvatar = peerAvatar,
            isOutgoing = true, status = CallStatus.RINGING,
            callType = if (isVideo) CallType.VIDEO else CallType.VOICE
        )
        currentCallIsVideo = isVideo

        // 1. Send ZIM call signal to peer so they can join the same Agora room
        try {
            val peerId = getPeerUserIdForConsultation(consultationId, myId)
            if (peerId != null) {
                ZegoChatManager.sendCallSignal(
                    toUserId = peerId,
                    roomId = roomId,
                    callType = if (isVideo) "video_call" else "voice_call",
                    callerId = myId,
                    callerName = myName
                )
                com.example.CrashLogger.log("[CALL] Sent ZIM signal: roomId=$roomId to=$peerId")
            } else {
                com.example.CrashLogger.log("[CALL] WARNING: Could not find peer ID for consultation $consultationId")
            }
        } catch (e: Throwable) {
            com.example.CrashLogger.log("[CALL] Failed to send ZIM signal: ${e.message}")
        }

        // 2. Notify server via WebSocket
        try {
            MedikaNetwork.sendCallStart(
                consultationId = consultationId,
                callType = if (isVideo) "video" else "voice",
                roomName = roomId,
                callerName = myName
            )
        } catch (e: Throwable) {
            com.example.CrashLogger.log("[CALL] WS sendCallStart failed: ${e.message}")
        }

        // 3. Insert system message
        viewModelScope.launch {
            repository.insertMessage(
                MessageEntity(consultationId = consultationId, senderId = "system", senderName = "Systeme",
                    text = "Appel ${if (isVideo) "video" else "vocal"} sortant...")
            )
        }

        // 4. Launch CallActivity (Agora-based, fetches its own token from port 9999)
        currentRoomName = roomId
        val appContext = getApplication<Application>()
        try {
            appContext.startActivity(
                Intent(appContext, Class.forName("com.example.ui.screens.CallActivity")).apply {
                    putExtra("ROOM_ID", roomId)
                    putExtra("USER_ID", myId)
                    putExtra("USER_NAME", myName)
                    putExtra("IS_VIDEO", isVideo)
                    putExtra("CONSULTATION_ID", consultationId)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                }
            )
            com.example.CrashLogger.log("[CALL] Opened CallActivity: roomId=$roomId uid=$myId video=$isVideo")
        } catch (e: Throwable) {
            com.example.CrashLogger.log("[CALL] Failed to open CallActivity: ${e.javaClass.name}: ${e.message}")
            cleanupCall()
        }
    }

    // ─── Incoming Call ─────────────────────────────────

    fun acceptIncomingCall() {
        val incoming = _incomingCall.value ?: return
        val isVideo = incoming.callType == "video"

        val app = getApplication<Application>()
        if (!hasCallPermissions(app, isVideo)) {
            pendingIncomingCall = incoming
            pendingCallNeedsVideo = isVideo
            _requestCallPermissions.value = true
            return
        }

        executeAcceptCall(incoming)
    }

    var pendingIncomingCall: IncomingCallEvent? = null
        private set

    fun onIncomingCallPermissionsResult(granted: Boolean) {
        _requestCallPermissions.value = false
        val incoming = pendingIncomingCall
        pendingIncomingCall = null
        if (granted && incoming != null) {
            executeAcceptCall(incoming)
        } else {
            rejectIncomingCall()
        }
    }

    private fun executeAcceptCall(incoming: IncomingCallEvent) {
        val isVideo = incoming.callType == "video"
        currentCallIsVideo = isVideo
        currentRoomName = incoming.roomName

        val myId = currentServerUserId ?: return
        val myName = currentUserName ?: "User"

        _activeCall.value = CallSession(
            consultationId = incoming.consultationId, peerName = incoming.fromName, peerAvatar = null,
            isOutgoing = false, status = CallStatus.RINGING,
            callType = if (isVideo) CallType.VIDEO else CallType.VOICE
        )
        _incomingCall.value = null

        com.example.CrashLogger.log("[CALL] Accepting incoming ${incoming.callType} call from ${incoming.fromName} (room=${incoming.roomName})")

        MedikaNetwork.sendCallAccept(incoming.consultationId)

        // Launch CallActivity directly (Agora-based, fetches its own token from port 9999)
        val appContext = getApplication<Application>()
        try {
            appContext.startActivity(
                Intent(appContext, Class.forName("com.example.ui.screens.CallActivity")).apply {
                    putExtra("ROOM_ID", incoming.roomName)
                    putExtra("USER_ID", myId)
                    putExtra("USER_NAME", myName)
                    putExtra("IS_VIDEO", isVideo)
                    putExtra("CONSULTATION_ID", incoming.consultationId)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                }
            )
            com.example.CrashLogger.log("[CALL] Accept: Opened CallActivity: roomId=${incoming.roomName} uid=$myId")
        } catch (e: Throwable) {
            com.example.CrashLogger.log("[CALL] Accept: Failed to open CallActivity: ${e.javaClass.name}: ${e.message}")
            cleanupCall()
        }
    }

    fun rejectIncomingCall() {
        val incoming = _incomingCall.value ?: return
        MedikaNetwork.sendCallReject(incoming.consultationId)
        _incomingCall.value = null
    }

    // ─── ZEGOCLOUD Call Connection ────────────────────────────
    // The ZegoUIKitPrebuiltCallInvitationService handles the entire call UI and WebRTC
    // connection. We don't need to connect manually — the
    // ZegoSendCallInvitationButton in ChatScreen triggers the call and Zego
    // shows the call UI automatically.


    // ─── ZEGO Direct-Join Call (ZIM signaling) ────────────────

    /**
     * Initiates a call by sending a ZIM message to the peer, then opens
     * CallActivity. The peer receives the ZIM message and auto-opens
     * CallActivity with the same roomID.
     */
    fun sendCallRequest(
        context: android.content.Context,
        roomId: String,
        peerId: String,
        peerName: String,
        isVideo: Boolean
    ) {
        val myId = currentServerUserId ?: return
        val myName = currentUserName ?: "User"
        val type = if (isVideo) "video_call" else "voice_call"

        // Send ZIM message to peer so they can join the same room
        try {
            ZegoChatManager.sendCallSignal(
                toUserId = peerId,
                roomId = roomId,
                callType = type,
                callerId = myId,
                callerName = myName
            )
            com.example.CrashLogger.log("[CALL] Sent $type signal: roomId=$roomId to=$peerId")
        } catch (e: Throwable) {
            com.example.CrashLogger.log("[CALL] Failed to send signal: ${e.message}")
            return
        }

        // Open CallActivity for the caller
        context.startActivity(
            Intent(context, Class.forName("com.example.ui.screens.CallActivity")).apply { putExtra("ROOM_ID", roomId); putExtra("USER_ID", myId); putExtra("USER_NAME", myName); putExtra("IS_VIDEO", isVideo); putExtra("CONSULTATION_ID", roomId); addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP) }
        )
        com.example.CrashLogger.log("[CALL] Caller opened CallActivity: roomId=$roomId")
    }

    /**
     * Called by ZegoChatManager when a call signal ZIM message is received.
     * Opens CallActivity so this user joins the same room.
     */
    fun onIncomingCallSignal(roomId: String, callType: String, callerName: String, callerId: String, context: android.content.Context) {
        val myId = currentServerUserId ?: return
        val myName = currentUserName ?: "User"
        val isVideo = callType == "video_call"

        com.example.CrashLogger.log("[CALL] Incoming $callType from $callerName, roomId=$roomId, showing incoming call UI")

        // Launch IncomingCallActivity with Accept/Reject buttons instead of auto-answering
        context.startActivity(
            Intent(context, com.example.ui.screens.IncomingCallActivity::class.java).apply {
                putExtra("room_id", roomId)
                putExtra("caller_id", callerId)
                putExtra("caller_name", callerName)
                putExtra("is_video", isVideo)
                putExtra("consultation_id", roomId)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )
    }

    /**
     * Called when the user accepts an incoming call from IncomingCallActivity.
     * Launches CallActivity to join the Agora room.
     */
    fun onIncomingCallAccepted(roomId: String, callerName: String, isVideo: Boolean, context: android.content.Context) {
        val myId = currentServerUserId ?: return
        val myName = currentUserName ?: "User"

        com.example.CrashLogger.log("[CALL] User ACCEPTED incoming call, joining room=$roomId")

        // Notify server
        try {
            MedikaNetwork.sendCallAccept(roomId)
        } catch (e: Exception) {
            com.example.CrashLogger.log("[CALL] sendCallAccept error: ${e.message}")
        }

        // Launch CallActivity
        try {
            context.startActivity(
                Intent(context, Class.forName("com.example.ui.screens.CallActivity")).apply {
                    putExtra("ROOM_ID", roomId)
                    putExtra("USER_ID", myId)
                    putExtra("USER_NAME", myName)
                    putExtra("PEER_NAME", callerName)
                    putExtra("IS_VIDEO", isVideo)
                    putExtra("CONSULTATION_ID", roomId)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                }
            )
        } catch (e: Throwable) {
            com.example.CrashLogger.log("[CALL] Failed to open CallActivity: ${e.message}")
        }
    }

    private suspend fun connectToLiveKitRoom(lkToken: String, lkUrl: String, isVideo: Boolean) {
        // No-op: Zego UIKit handles the connection when the user taps
        // ZegoSendCallInvitationButton.
        println("[ZEGO] connectToLiveKitRoom is a no-op — Zego UIKit handles connection")
    }

    // ─── Video Attachment ─────────────────────────────────

    var remoteVideoRenderer: Any? = null
    var localVideoRenderer: Any? = null

    private fun attachRemoteVideo() { /* no-op: Zego handles video */ }
    private fun attachLocalVideo() { /* no-op: Zego handles video */ }

    // ─── End Call ────────────────────────────────────

    fun endCall() {
        try {
            // Zego UIKit handles call ending via its own UI
        } catch (e: Exception) {
            println("[ZEGO] endCall error: ${e.message}")
        }
        cleanupCall()
    }

    private fun cleanupCall() {
        callTimerJob?.cancel()
        currentRoomName = null
        _livekitConnected.value = false

        val current = _activeCall.value
        _activeCall.value = null  // Clear immediately so next call works

        viewModelScope.launch {
            if (current != null && current.status == CallStatus.ACTIVE) {
                val formattedTime = String.format("%02d:%02d", current.durationSeconds / 60, current.durationSeconds % 60)
                if (current.consultationId.isNotEmpty()) {
                    repository.insertMessage(
                        MessageEntity(consultationId = current.consultationId, senderId = "system", senderName = "Systeme",
                            text = "Appel termine. Duree : $formattedTime.")
                    )
                }
            }
            // _activeCall already cleared below
        }
    }

    // ─── Call Controls ─────────────────────────────────

    fun toggleMute() {
        try {
            val newState = !true // Zego UIKit handles mic
            // Zego UIKit handles mic
            val currentState = _activeCall.value ?: return
            _activeCall.value = currentState.copy(isMuted = !newState)
        } catch (e: Exception) {
            println("[ZEGO] toggleMute error: ${e.message}")
        }
    }

    fun toggleSpeaker() {
        val current = _activeCall.value ?: return
        _activeCall.value = current.copy(isSpeakerOn = !current.isSpeakerOn)
    }

    fun toggleCamera() {
        try {
            val newState = !true // Zego UIKit handles camera
            // Zego UIKit handles camera
            val currentState = _activeCall.value ?: return
            _activeCall.value = currentState.copy(isCameraOn = newState)
        } catch (e: Exception) {
            println("[ZEGO] toggleCamera error: ${e.message}")
        }
    }

    fun setCallMinimized(minimized: Boolean) {
        if (minimized) {
        // Zego UIKit handles minimize
        }
        val current = _activeCall.value ?: return
        _activeCall.value = current.copy(isMinimized = minimized)
    }

    private fun startCallTimer() {
        callTimerJob?.cancel()
        callTimerJob = viewModelScope.launch {
            while (true) {
                delay(1000)
                val current = _activeCall.value
                if (current != null && current.status == CallStatus.ACTIVE) {
                    _activeCall.value = current.copy(durationSeconds = current.durationSeconds + 1)
                } else break
            }
        }
    }

    // ─── Voice Recording (with permission request) ──────────────────────

    fun requestMicAndStartRecording(senderId: String, senderName: String) {
        val app = getApplication<Application>()
        val hasPermission = ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (hasPermission) {
            startVoiceRecording()
        } else {
            pendingVoiceSender = Pair(senderId, senderName)
            pendingVoiceAction = "start"
            _requestMicPermission.value = true
        }
    }

    fun onStoragePermissionResult(granted: Boolean) {
        if (granted) {
            // Re-attempt the pending media send
            pendingMediaParams?.let { (consultationId, mimeType, filePath) ->
                _uploadError.value = "Media importé avec succès"
                pendingMediaParams = null
            }
        }
    }

    fun onMicPermissionResult(granted: Boolean) {
        _requestMicPermission.value = false
        if (granted) {
            if (pendingVoiceAction == "start") {
                startVoiceRecording()
            }
        }
        pendingVoiceSender = null
        pendingVoiceAction = null
    }

    fun startVoiceRecording() {
        if (_isRecording.value) return
        val app = getApplication<Application>()
        val consultationId = _activeConsultationId.value ?: "general"
        // Save the recording directly into the per-consultation folder so we
        // don't need to copy it afterwards. This becomes the local cached copy.
        val audioDir = medikaMediaDir(consultationId)
        val file = File(audioDir, "voice_${System.currentTimeMillis()}.m4a")
        currentRecordingFile = file

        try {
            mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(app)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
            _isRecording.value = true
            _recordingDuration.value = 0
            recordingTimerJob = viewModelScope.launch {
                while (true) {
                    delay(1000)
                    if (_isRecording.value) {
                        _recordingDuration.value += 1
                    } else break
                }
            }
            println("[VOICE] Recording started -> ${file.absolutePath}")
        } catch (e: Exception) {
            println("[VOICE] Error starting recording: ${e.message}")
            _isRecording.value = false
            currentRecordingFile = null
        }
    }

    fun stopAndSendVoiceRecording(senderId: String, senderName: String) {
        if (!_isRecording.value) return
        recordingTimerJob?.cancel()
        val file = currentRecordingFile

        try {
            mediaRecorder?.apply {
                stop()
                release()
            }
        } catch (e: Exception) {
            println("[VOICE] Error stopping recording: ${e.message}")
        }
        mediaRecorder = null
        val durationSec = _recordingDuration.value
        _isRecording.value = false
        _recordingDuration.value = 0

        val consultationId = _activeConsultationId.value
        if (file == null || !file.exists() || consultationId == null) {
            currentRecordingFile = null
            return
        }
        if (file.length() == 0L) {
            println("[VOICE] Empty recording, discarding")
            file.delete()
            currentRecordingFile = null
            return
        }

        // ── Local-first send flow ───────────────────────────────────────
        // 1. Insert DB row with localFilePath set + sendStatus="sending" so
        //    the bubble appears immediately and plays from the local file.
        // 2. Upload to server (passing consultationId for per-consult folder).
        // 3. On success: broadcast via WS and flip sendStatus to "sent" with
        //    the server fileUrl. On failure: sendStatus="failed" (retry button).
        viewModelScope.launch {
            val ts = System.currentTimeMillis()
            val localPath = file.absolutePath
            val rowId = run {
                val entity = MessageEntity(
                    consultationId = consultationId,
                    senderId = senderId,
                    senderName = senderName,
                    text = "",
                    timestamp = ts,
                    messageType = "voice",
                    fileUrl = null,
                    duration = durationSec,
                    fileSize = file.length(),
                    localFilePath = localPath,
                    sendStatus = "sending"
                )
                repository.insertMessage(entity)
                // Re-fetch to get the auto-generated id
                repository.getMessagesForConsultationOnce(consultationId)
                    .firstOrNull { it.timestamp == ts && it.senderId == senderId && it.localFilePath == localPath }
                    ?.id
            }
            println("[VOICE] Inserted local row id=$rowId, sending via ZIM...")

            val peerUserId = getPeerUserIdForConsultation(consultationId, senderId)
            if (peerUserId == null) {
                if (rowId != null) repository.updateMessageStatus(rowId, "failed", null, localPath)
                _uploadError.value = "Impossible de trouver le destinataire"
                println("[VOICE] No peer user ID found")
                currentRecordingFile = null
                return@launch
            }

            // Send via ZIM — ZIM uploads the audio to its CDN automatically.
            withContext(Dispatchers.IO) {
                ZegoChatManager.sendAudioMessage(
                    localPath, durationSec.toLong(), peerUserId, consultationId, senderName
                ) { success, errMsg ->
                    viewModelScope.launch {
                        if (success && rowId != null) {
                            // The file URL isn't known until ZIM uploads it; we keep
                            // localFilePath so playback works offline.
                            repository.updateMessageStatus(rowId, "sent", null, localPath)
                            println("[VOICE] ZIM send OK for row $rowId")
                        } else if (rowId != null) {
                            repository.updateMessageStatus(rowId, "failed", null, localPath)
                            _uploadError.value = "Echec envoi vocal: ${errMsg ?: "erreur inconnue"}"
                            println("[VOICE] ZIM send FAILED for row $rowId: $errMsg")
                        }
                    }
                }
            }
        }
        currentRecordingFile = null
    }

    // ─── Voice Playback ──────────────────────────────────

    /**
     * Download a media file on-demand for playback.
     * Handles both server-relative URLs ("/uploads/...") and absolute URLs (ZIM CDN).
     * Returns the local File if successful, null otherwise.
     */
    private suspend fun downloadMediaForPlayback(message: MessageEntity): File? = withContext(Dispatchers.IO) {
        val fileUrl = message.fileUrl ?: return@withContext null
        val consultationId = message.consultationId

        // Determine target local file path
        val target = if (!fileUrl.startsWith("http")) {
            // Server-relative URL (e.g. "/uploads/consId/file.m4a")
            localFileForReceivedMessage(consultationId, fileUrl)
        } else {
            // Absolute URL (ZIM CDN) — extract filename or generate one
            val dir = medikaMediaDir(consultationId)
            val urlName = fileUrl.substringAfterLast('/').ifBlank { "zim_playback_${message.timestamp}" }
            File(dir, urlName)
        } ?: run {
            val dir = medikaMediaDir(consultationId)
            val ext = when (message.messageType) {
                "voice" -> ".m4a"
                "video" -> ".mp4"
                "image" -> ".jpg"
                else -> ""
            }
            File(dir, "playback_${message.timestamp}$ext")
        }

        // If file already exists locally, return it
        if (target.exists() && target.length() > 0) return@withContext target

        // Build the full download URL
        val fullUrl = if (fileUrl.startsWith("http")) fileUrl else "https://medikahaiti.site$fileUrl"

        try {
            println("[PLAYBACK-DL] Downloading $fullUrl -> ${target.absolutePath}")
            java.net.URL(fullUrl).openStream().use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            }
            if (target.exists() && target.length() > 0) {
                println("[PLAYBACK-DL] OK ${target.length()} bytes")
                target
            } else {
                println("[PLAYBACK-DL] Downloaded file is empty")
                null
            }
        } catch (e: Exception) {
            println("[PLAYBACK-DL] Error: ${e.message}")
            null
        }
    }

    fun playVoiceMessage(message: MessageEntity) {
        stopVoicePlayback()
        var path = message.localFilePath

        // If localFilePath is set but file doesn't exist (e.g. deleted, wrong path),
        // clear it and fall through to on-demand download
        if (!path.isNullOrBlank() && !File(path).exists()) {
            com.example.CrashLogger.log("[VOICE] localFilePath exists but file missing: $path — will re-download")
            path = null
        }

        if (path.isNullOrBlank()) {
            // No local file — try on-demand download if we have a URL
            if (!message.fileUrl.isNullOrBlank()) {
                _isPlayingVoice.value = true  // Show loading/playing state while downloading
                viewModelScope.launch {
                    val local = downloadMediaForPlayback(message)
                    if (local != null) {
                        // Update DB so we don't re-download next time
                        repository.updateMessageLocalFile(message.id, local.absolutePath, local.length())
                        // Now play the downloaded file
                        actuallyPlayVoice(local.absolutePath)
                    } else {
                        _isPlayingVoice.value = false
                        _uploadError.value = "Fichier audio non disponible"
                    }
                }
            } else {
                _uploadError.value = "Fichier audio non disponible"
            }
            return
        }
        actuallyPlayVoice(path)
    }

    /** Core voice playback logic — used after confirming a valid local path exists. */
    private fun actuallyPlayVoice(path: String) {
        val file = File(path)
        if (!file.exists()) {
            _uploadError.value = "Fichier audio introuvable"
            _isPlayingVoice.value = false
            return
        }
        try {
            mediaPlayer = MediaPlayer().apply {
                setDataSource(path)
                prepare()
                setOnCompletionListener {
                    _isPlayingVoice.value = false
                    mediaPlayer?.release()
                    mediaPlayer = null
                }
                setOnErrorListener { _, _, _ ->
                    _isPlayingVoice.value = false
                    mediaPlayer?.release()
                    mediaPlayer = null
                    true
                }
                start()
            }
            _isPlayingVoice.value = true
            println("[VOICE] Playing: $path")
        } catch (e: Exception) {
            println("[VOICE] Playback error: ${e.message}")
            _isPlayingVoice.value = false
            _uploadError.value = "Erreur de lecture audio"
        }
    }

    fun stopVoicePlayback() {
        try {
            mediaPlayer?.apply {
                if (isPlaying) stop()
                release()
            }
        } catch (_: Exception) {}
        mediaPlayer = null
        _isPlayingVoice.value = false
    }

    /** Retry sending a voice/media message that previously failed (via ZIM). */
    fun retrySendMediaMessage(messageId: Int) {
        viewModelScope.launch {
            val msg = repository.getMessageById(messageId) ?: return@launch
            if (msg.sendStatus != "failed") return@launch
            if (msg.localFilePath.isNullOrBlank()) return@launch
            val consultationId = msg.consultationId
            repository.updateMessageStatus(messageId, "sending", msg.fileUrl, msg.localFilePath)
            println("[RETRY] Retrying msg $messageId (${msg.messageType}) via ZIM")

            val peerUserId = getPeerUserIdForConsultation(consultationId, msg.senderId)
            if (peerUserId == null) {
                repository.updateMessageStatus(messageId, "failed", msg.fileUrl, msg.localFilePath)
                _uploadError.value = "Impossible de trouver le destinataire"
                return@launch
            }

            withContext(Dispatchers.IO) {
                val callback: (Boolean, String?) -> Unit = { success, errMsg ->
                    viewModelScope.launch {
                        if (success) {
                            repository.updateMessageStatus(messageId, "sent", msg.fileUrl, msg.localFilePath)
                            println("[RETRY] OK msg $messageId via ZIM")
                        } else {
                            repository.updateMessageStatus(messageId, "failed", msg.fileUrl, msg.localFilePath)
                            _uploadError.value = "Echec renvoi: ${errMsg ?: "erreur inconnue"}"
                            println("[RETRY] Failed again for msg $messageId: $errMsg")
                        }
                    }
                }
                when (msg.messageType) {
                    "voice" -> ZegoChatManager.sendAudioMessage(
                        msg.localFilePath, (msg.duration ?: 0).toLong(),
                        peerUserId, consultationId, msg.senderName, callback
                    )
                    "image" -> ZegoChatManager.sendImageMessage(
                        msg.localFilePath, peerUserId, consultationId, msg.senderName, callback
                    )
                    "video" -> ZegoChatManager.sendVideoMessage(
                        msg.localFilePath, (msg.duration ?: 0).toLong(),
                        peerUserId, consultationId, msg.senderName, callback
                    )
                    else -> callback(false, "Type inconnu: ${msg.messageType}")
                }
            }
        }
    }

    // ─── Media Messages (via ZIM — ZIM handles upload to its CDN) ─────────

    fun sendMediaMessage(context: Context, uri: android.net.Uri, senderId: String, senderName: String, mimeType: String) {
        val consultationId = _activeConsultationId.value ?: return

        viewModelScope.launch {
            try {
                // Copy URI into the per-consultation folder so the file persists
                // across cache evictions and is available offline.
                val localFile = withContext(Dispatchers.IO) {
                    copyUriToConsultationDir(context, uri, consultationId, mimeType)
                } ?: run {
                    println("[MEDIA] Failed to copy URI to file")
                    return@launch
                }

                val messageType = when {
                    mimeType.startsWith("image/") -> "image"
                    mimeType.startsWith("video/") -> "video"
                    mimeType.startsWith("audio/") -> "voice"
                    else -> "image"
                }

                // 1. Insert local row immediately so bubble shows up.
                val ts = System.currentTimeMillis()
                val localPath = localFile.absolutePath
                val rowId = run {
                    val entity = MessageEntity(
                        consultationId = consultationId,
                        senderId = senderId,
                        senderName = senderName,
                        text = "",
                        timestamp = ts,
                        messageType = messageType,
                        fileUrl = null,
                        duration = if (messageType == "voice") 0 else null,
                        fileSize = localFile.length(),
                        localFilePath = localPath,
                        sendStatus = "sending"
                    )
                    repository.insertMessage(entity)
                    repository.getMessagesForConsultationOnce(consultationId)
                        .firstOrNull { it.timestamp == ts && it.senderId == senderId && it.localFilePath == localPath }
                        ?.id
                }
                println("[MEDIA] Inserted local row id=$rowId (${messageType}, ${localFile.length() / 1024}KB), sending via ZIM...")

                val peerUserId = getPeerUserIdForConsultation(consultationId, senderId)
                if (peerUserId == null) {
                    if (rowId != null) repository.updateMessageStatus(rowId, "failed", null, localPath)
                    _uploadError.value = "Impossible de trouver le destinataire"
                    println("[MEDIA] No peer user ID found")
                    return@launch
                }

                // 2. Send via ZIM — ZIM uploads the file to its CDN automatically.
                // Fall back to WebSocket if ZIM is not logged in.
                val zimReady = withContext(Dispatchers.IO) { ZegoChatManager.isLoggedIn() }
                if (zimReady) {
                    withContext(Dispatchers.IO) {
                        val callback: (Boolean, String?) -> Unit = { success, errMsg ->
                            viewModelScope.launch {
                                if (success && rowId != null) {
                                    repository.updateMessageStatus(rowId, "sent", null, localPath)
                                    println("[MEDIA] ZIM $messageType send OK for row $rowId")
                                } else if (rowId != null) {
                                    // ZIM failed — try WS fallback
                                    println("[MEDIA] ZIM send FAILED for row $rowId: $errMsg — trying WS fallback")
                                    val wsOk = MedikaNetwork.sendMessage(consultationId, senderId, senderName, "[Image]", messageType)
                                    if (wsOk) repository.updateMessageStatus(rowId, "sent", null, localPath)
                                    else {
                                        repository.updateMessageStatus(rowId, "failed", null, localPath)
                                        _uploadError.value = "Echec envoi media: ${errMsg ?: "erreur inconnue"}"
                                    }
                                }
                            }
                        }
                        when (messageType) {
                            "voice" -> ZegoChatManager.sendAudioMessage(
                                localPath, 0L, peerUserId, consultationId, senderName, callback
                            )
                            "image" -> ZegoChatManager.sendImageMessage(
                                localPath, peerUserId, consultationId, senderName, callback
                            )
                            "video" -> ZegoChatManager.sendVideoMessage(
                                localPath, 0L, peerUserId, consultationId, senderName, callback
                            )
                            else -> callback(false, "Type inconnu: $messageType")
                        }
                    }
                } else {
                    // ZIM not ready — notify user
                    println("[MEDIA] ZIM not logged in — cannot send $messageType via ZIM")
                    if (rowId != null) {
                        repository.updateMessageStatus(rowId, "failed", null, localPath)
                        _uploadError.value = "Chat non disponible (ZIM hors ligne). Reessayez."
                    }
                }
            } catch (e: Exception) {
                println("[MEDIA] Error: ${e.message}")
            }
        }
    }

    /** Copy a picked-content URI into filesDir/medika/{consultationId}/ with the right extension. */
    private suspend fun copyUriToConsultationDir(
        context: Context, uri: android.net.Uri, consultationId: String, mimeType: String
    ): File? = withContext(Dispatchers.IO) {
        try {
            val ext = when (mimeType) {
                "image/jpeg" -> ".jpg"
                "image/png" -> ".png"
                "image/gif" -> ".gif"
                "image/webp" -> ".webp"
                "video/mp4" -> ".mp4"
                "video/3gp" -> ".3gp"
                "video/webm" -> ".webm"
                "audio/mpeg", "audio/mp3" -> ".mp3"
                "audio/mp4", "audio/m4a" -> ".m4a"
                "audio/wav" -> ".wav"
                "audio/ogg" -> ".ogg"
                "audio/webm" -> ".webm"
                else -> ".bin"
            }
            val dir = medikaMediaDir(consultationId)
            val outFile = File(dir, "media_${System.currentTimeMillis()}$ext")
            context.contentResolver.openInputStream(uri)?.use { input ->
                outFile.outputStream().use { output -> input.copyTo(output) }
            }
            if (outFile.exists() && outFile.length() > 0) outFile else null
        } catch (e: Exception) {
            println("[MEDIA] Error copying URI: ${e.message}")
            null
        }
    }

    private fun copyUriToFile(context: Context, uri: android.net.Uri): File? {
        return try {
            val extension = when (context.contentResolver.getType(uri)) {
                "image/jpeg" -> ".jpg"
                "image/png" -> ".png"
                "image/gif" -> ".gif"
                "image/webp" -> ".webp"
                "video/mp4" -> ".mp4"
                "video/3gp" -> ".3gp"
                "video/webm" -> ".webm"
                else -> ".tmp"
            }
            val cacheFile = File(context.cacheDir, "media_${System.currentTimeMillis()}$extension")
            context.contentResolver.openInputStream(uri)?.use { input ->
                cacheFile.outputStream().use { output -> input.copyTo(output) }
            }
            if (cacheFile.exists() && cacheFile.length() > 0) cacheFile else null
        } catch (e: Exception) {
            println("[MEDIA] Error copying URI: ${e.message}")
            null
        }
    }

        // ─── Admin ───────────────────────────────────────

    fun loginAdmin(username: String, password: String) {
        _authState.value = AuthState.Loading
        _loginError.value = null
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val response = MedikaNetwork.api.adminLogin(LoginRequest(username, password))
                authToken = "Bearer " + response.token
                currentServerUserId = response.user.id
                currentUserName = response.user.name
                MedikaNetwork.authToken = "Bearer " + response.token
                withContext(Dispatchers.Main) { handleAuthResponse(response); saveSession(response.token, response.user) }
            } catch (e: java.lang.StackOverflowError) {
                withContext(Dispatchers.Main) { _authState.value = AuthState.Unauthenticated; _loginError.value = "Erreur pile" }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { _authState.value = AuthState.Unauthenticated; _loginError.value = "Identifiants invalides" }
            }
        }
    }

    fun syncAdminData() {
        val token = authToken ?: return
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val docs = MedikaNetwork.api.adminGetDoctors(token)
                val ents = docs.map { d ->
                    DoctorEntity(id=(d["id"] as? String) ?: "", name=(d["name"] as? String) ?: "",
                        specialty=(d["specialty"] as? String) ?: "Medecine Generale", licenseNumber=(d["license_number"] as? String) ?: "",
                        location=(d["location"] as? String) ?: "", avatarUrl=(d["avatar_url"] as? String) ?: "",
                        rating=when(val r=d["rating"]){is Number->r.toDouble();else->4.9},
                        isAvailable=when(val a=d["is_available"]){is Number->a.toInt()==1;else->true},
                        hospital=(d["hospital"] as? String) ?: "", biography=(d["biography"] as? String) ?: "")
                }
                repository.insertDoctors(ents)
                val cons = MedikaNetwork.api.adminGetConsultations(token)
                for (sc in cons) {
                    val e = serverMapToConsultationEntity(sc)
                    val x = repository.getConsultationById(e.id)
                    if (x != null) repository.updateConsultation(e) else repository.insertConsultation(e)
                }
            } catch (e: Exception) { println("[ADMIN] Sync: " + e.message) }
        }
    }

    fun adminCreateDoctor(name: String, specialty: String, licenseNumber: String, location: String, hospital: String, biography: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val token = authToken ?: return@launch
                val body = mapOf("name" to name, "specialty" to specialty, "licenseNumber" to licenseNumber,
                    "location" to location, "hospital" to hospital, "biography" to biography,
                    "username" to name.lowercase().replace(" ", ".") + "_" + System.currentTimeMillis() % 10000,
                    "password" to "medika2024")
                MedikaNetwork.api.adminCreateDoctorApi(token, body)
                syncAdminData()
            } catch (e: Exception) { _uploadError.value = "Erreur: " + (e.localizedMessage ?: "inconnue") }
        }
    }

    // ─── Support Tickets ──────────────────────────────────
    private val _tickets = MutableStateFlow<List<Map<String, Any?>>>(emptyList())
    val tickets: StateFlow<List<Map<String, Any?>>> = _tickets.asStateFlow()

    private val _currentTicketMessages = MutableStateFlow<List<Map<String, Any?>>>(emptyList())
    val currentTicketMessages: StateFlow<List<Map<String, Any?>>> = _currentTicketMessages.asStateFlow()

    private val _currentTicket = MutableStateFlow<Map<String, Any?>?>(null)
    val currentTicket: StateFlow<Map<String, Any?>?> = _currentTicket.asStateFlow()

    private val _ticketLoading = MutableStateFlow(false)
    val ticketLoading: StateFlow<Boolean> = _ticketLoading.asStateFlow()

    private val _ticketError = MutableStateFlow<String?>(null)
    val ticketError: StateFlow<String?> = _ticketError.asStateFlow()

    fun clearTicketError() { _ticketError.value = null }

    private var activeTicketId: String? = null

    fun fetchTickets() {
        val token = authToken ?: return
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val result = MedikaNetwork.api.getTickets(token)
                _tickets.value = result
            } catch (e: Exception) { println("[TICKET] Error fetching: ${e.message}") }
        }
    }

    fun createTicket(subject: String, onResult: (Boolean, String?) -> Unit) {
        val token = authToken ?: return
        _ticketLoading.value = true
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val ticket = MedikaNetwork.api.createTicket(token, CreateTicketRequest(subject = subject))
                _tickets.value = listOf(ticket) + _tickets.value
                withContext(Dispatchers.Main) { onResult(true, ticket["id"] as? String) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { onResult(false, e.localizedMessage) }
            }
            _ticketLoading.value = false
        }
    }

    fun openTicket(ticketId: String) {
        activeTicketId = ticketId
        val token = authToken ?: return
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val result = MedikaNetwork.api.getTicket(token, ticketId)
                _currentTicket.value = result
                @Suppress("UNCHECKED_CAST")
                _currentTicketMessages.value = (result["messages"] as? List<Map<String, Any?>>) ?: emptyList()
            } catch (e: Exception) {
                println("[TICKET] Error opening: ${e.message}")
                _ticketError.value = "Impossible de charger le ticket: ${e.localizedMessage ?: "erreur reseau"}"
            }
        }
    }

    fun sendTicketMessage(text: String, fileUrl: String? = null, fileType: String? = null, fileSize: Long? = null) {
        val token = authToken ?: return
        val tid = activeTicketId ?: return
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val body = SendMessageRequest(content = text, file_url = fileUrl, file_type = fileType, file_size = fileSize)
                val msg = MedikaNetwork.api.sendTicketMessage(token, tid, body)
                _currentTicketMessages.value = _currentTicketMessages.value + msg
            } catch (e: Exception) {
                println("[TICKET] Error sending: ${e.message}")
                val httpCode = (e as? HttpException)?.code()
                val msgBody = (e as? HttpException)?.response()?.errorBody()?.string()
                val errorMsg = when {
                    httpCode == 403 -> "Ce ticket est ferme. Vous ne pouvez plus envoyer de messages."
                    httpCode == 404 -> "Ticket introuvable."
                    msgBody != null -> { try { 
                        val jsonObj = org.json.JSONObject(msgBody)
                        jsonObj.optString("error", "Erreur inconnue")
                    } catch (_: Exception) { "Erreur du serveur" } }
                    else -> "Erreur de connexion: ${e.localizedMessage ?: "inconnue"}"
                }
                _ticketError.value = errorMsg
            }
        }
    }

    fun uploadTicketFile(uri: android.net.Uri, context: android.content.Context, onUploaded: (String?, String?, Long?) -> Unit) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val file = copyUriToCache(uri, context)
                if (file == null) {
                    println("[TICKET] Upload: could not read file from URI")
                    _ticketError.value = "Impossible de lire le fichier"
                    withContext(Dispatchers.Main) { onUploaded(null, null, null) }
                    return@launch
                }
                val reqBody = file.asRequestBody("multipart/form-data".toMediaTypeOrNull())
                val part = okhttp3.MultipartBody.Part.createFormData("file", file.name, reqBody)
                val token = authToken ?: return@launch
                val resp = MedikaNetwork.api.uploadTicketFile(token, part)
                withContext(Dispatchers.Main) { onUploaded(resp.url, resp.mimetype, resp.size) }
            } catch (e: Exception) {
                println("[TICKET] Upload error: ${e.message}")
                val msgBody = (e as? retrofit2.HttpException)?.response()?.errorBody()?.string()
                val errorMsg = when {
                    msgBody != null -> { try { org.json.JSONObject(msgBody).optString("error", "Erreur upload") } catch (_: Exception) { "Erreur upload" } }
                    else -> "Erreur upload: ${e.localizedMessage ?: "inconnue"}"
                }
                _ticketError.value = errorMsg
                withContext(Dispatchers.Main) { onUploaded(null, null, null) }
            }
        }
    }

    fun refreshCurrentTicket() {
        val tid = activeTicketId ?: return
        openTicket(tid)
    }

    // ─── Avatar Upload ──────────────────────────────────

    private fun copyUriToCache(uri: android.net.Uri, context: Context): File? {
        return try {
            val inputStream = context.contentResolver.openInputStream(uri) ?: return null
            val fileName = "avatar_${System.currentTimeMillis()}.jpg"
            val cacheFile = File(context.cacheDir, fileName)
            FileOutputStream(cacheFile).use { out ->
                inputStream.copyTo(out)
            }
            inputStream.close()
            cacheFile
        } catch (e: Exception) {
            println("[AVATAR] Error copying URI: ${e.message}")
            null
        }
    }

    fun uploadProfilePicture(uri: android.net.Uri, context: Context, onResult: (Boolean, String?) -> Unit) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val file = copyUriToCache(uri, context) ?: run {
                    withContext(Dispatchers.Main) { onResult(false, "Impossible de lire le fichier") }
                    return@launch
                }

                val mimeType = context.contentResolver.getType(uri) ?: "image/jpeg"
                val reqBody = file.asRequestBody(mimeType.toMediaTypeOrNull())
                val part = MultipartBody.Part.createFormData("file", file.name, reqBody)

                val token = authToken ?: run {
                    withContext(Dispatchers.Main) { onResult(false, "Non authentifie") }
                    return@launch
                }

                // Upload file to server
                val uploadResp = MedikaNetwork.api.uploadFile(token, part, "avatar")
                val avatarUrl = uploadResp.url

                // Update profile with new avatar URL
                MedikaNetwork.api.updateProfile(token, UpdateProfileRequest(avatarUrl = avatarUrl))

                // Get fresh profile to update auth state
                val freshUser = MedikaNetwork.api.getProfile(token)

                // Persist to SharedPreferences so avatar survives app restart
                saveSession(authToken!!.removePrefix("Bearer "), freshUser)

                withContext(Dispatchers.Main) {
                    val currentAuth = _authState.value
                    when (currentAuth) {
                        is AuthState.PatientAuthenticated -> {
                            _authState.value = AuthState.PatientAuthenticated(
                                currentAuth.profile, freshUser
                            )
                        }
                        is AuthState.DoctorAuthenticated -> {
                            _authState.value = AuthState.DoctorAuthenticated(
                                currentAuth.doctor, freshUser
                            )
                        }
                        else -> {}
                    }
                    onResult(true, null)
                }

                // Clean up temp file
                file.delete()
            } catch (e: Exception) {
                println("[AVATAR] Upload error: ${e.message}")
                withContext(Dispatchers.Main) { onResult(false, e.localizedMessage) }
            }
        }
    }

}  // end SanteViewModel

// ─── ViewModel Factory ───────────────────────────────────

class SanteViewModelFactory(
    private val application: Application,
    private val repository: SanteRepository
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(SanteViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return SanteViewModel(application, repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}