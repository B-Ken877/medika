package com.example.data.livekit

import android.app.Application
import android.util.Log
import com.example.CrashLogger
import im.zego.zim.ZIM
import im.zego.zim.callback.ZIMEventHandler
import im.zego.zim.callback.ZIMLoggedInCallback
import im.zego.zim.callback.ZIMMediaDownloadedCallback
import im.zego.zim.callback.ZIMMessageSentCallback

import im.zego.zim.entity.ZIMAppConfig
import im.zego.zim.entity.ZIMAudioMessage
import im.zego.zim.entity.ZIMError
import im.zego.zim.entity.ZIMFileMessage
import im.zego.zim.entity.ZIMImageMessage
import im.zego.zim.entity.ZIMMediaMessage
import im.zego.zim.entity.ZIMMessage
import im.zego.zim.entity.ZIMMessageSendConfig
import im.zego.zim.entity.ZIMTextMessage
import im.zego.zim.entity.ZIMUserInfo
import im.zego.zim.entity.ZIMVideoMessage
import im.zego.zim.enums.ZIMConversationType
import im.zego.zim.enums.ZIMErrorCode
import im.zego.zim.enums.ZIMMediaFileType
import org.json.JSONObject

/**
 * Manages ZEGOCLOUD ZIM SDK for in-app chat.
 *
 * IMPORTANT: init() is NON-BLOCKING (fire-and-forget). It creates the ZIM
 * instance synchronously and kicks off login() asynchronously via callback.
 * This ensures ZIM init can NEVER crash or block the login flow, even if
 * the ZIM server is unreachable.
 *
 * Use isInitialized() to check if the ZIM instance was created.
 * Use isLoggedIn() to check if login completed.
 * Send methods check isLoggedIn() and return an error if not logged in.
 */
object ZegoChatManager {

    private const val TAG = "[ZIM]"
    private const val APP_ID: Long = 797048152L
    private const val APP_SIGN = "2354370a67b4ec724ff5328f31d03367532fdabe65420681f58f7ff98fc672d2"

    @Volatile
    private var initialized = false

    @Volatile
    private var loggedIn = false

    private var zim: ZIM? = null
    private var currentUserId: String? = null

    var onMessageReceived: ((ZimIncomingMessage) -> Unit)? = null
    var onConnectionChanged: ((connected: Boolean) -> Unit)? = null

    /** Callback for when login completes (success or failure). */
    var onLoginResult: ((success: Boolean, errorCode: String, errorMessage: String) -> Unit)? = null

    fun isInitialized(): Boolean = initialized
    fun isLoggedIn(): Boolean = loggedIn && zim != null
    fun getCurrentUserId(): String? = currentUserId

    /**
     * Initialize ZIM and log in. NON-BLOCKING — returns immediately after
     * creating the ZIM instance. Login happens asynchronously via callback.
     *
     * @return true if the ZIM instance was created (login continues in background)
     */
    fun init(application: Application, userId: String, userName: String): Boolean {
        if (userId.isBlank()) {
            CrashLogger.log("[ZIM] init FAILED: blank userId")
            return false
        }
        if (zim != null && initialized) {
            CrashLogger.log("[ZIM] already initialized — skipping")
            return true
        }
        currentUserId = userId

        return try {
            CrashLogger.log("[ZIM] Before create — ZIM.getInstance() returns: ${try { ZIM.getInstance()?.let { "EXISTS hash=${System.identityHashCode(it)}" } ?: "null" } catch (e: Throwable) { "getInstance() threw: ${e.javaClass.simpleName}" }}")
            val appConfig = ZIMAppConfig().apply {
                appID = APP_ID
                appSign = APP_SIGN
            }
            zim = ZIM.create(appConfig, application)
            CrashLogger.log("[ZIM] After create — new instance hash=${zim?.let { System.identityHashCode(it) }}, ZIM.getInstance() now=${try { ZIM.getInstance()?.let { System.identityHashCode(it) } } catch (e: Throwable) { "threw" }}")
            if (zim == null) {
                initialized = false
                loggedIn = false
                CrashLogger.log("[ZIM] ZIM.create() returned null — AppID/AppSign invalid")
                onLoginResult?.invoke(false, "CREATE_NULL", "ZIM.create() returned null (check AppID/AppSign)")
                return false
            }
            initialized = true
            CrashLogger.log("[ZIM] ZIM instance created OK")

            // Set event handler BEFORE login
            CrashLogger.log("[ZIM] About to call setEventHandler — this OVERWRITES any handler the call SDK may have registered for invitations")
            zim!!.setEventHandler(object : ZIMEventHandler() {
                override fun onReceivePeerMessage(zim: ZIM, messages: ArrayList<ZIMMessage>, fromUserID: String) {
                    CrashLogger.log("[ZIM] onReceivePeerMessage: ${messages.size} msgs from $fromUserID")
                    for (msg in messages) {
                        val incoming = mapZimMessage(msg, fromUserID)
                        if (incoming != null) {
                            onMessageReceived?.invoke(incoming)
                        }
                    }
                }

                override fun onConnectionStateChanged(zim: ZIM, state: im.zego.zim.enums.ZIMConnectionState, event: im.zego.zim.enums.ZIMConnectionEvent, info: JSONObject) {
                    val connected = state == im.zego.zim.enums.ZIMConnectionState.CONNECTED
                    CrashLogger.log("[ZIM] Connection state: $state event=$event (connected=$connected)")
                    loggedIn = connected
                    onConnectionChanged?.invoke(connected)
                }

                override fun onError(zim: ZIM, error: ZIMError) {
                    CrashLogger.log("[ZIM] onError: code=${error.code} message=${error.message}")
                }
            })

            // Log in — ASYNCHRONOUS (non-blocking). The callback fires later.
            val userInfo = ZIMUserInfo().apply {
                this.userID = userId
                this.userName = if (userName.isBlank()) "User" else userName
            }
            CrashLogger.log("[ZIM] Logging in (async): userId=$userId, userName=${userInfo.userName}")

            zim!!.login(userInfo, object : ZIMLoggedInCallback {
                override fun onLoggedIn(error: ZIMError) {
                    val success = error.code == ZIMErrorCode.SUCCESS
                    loggedIn = success
                    val errCodeName = error.code?.name ?: "UNKNOWN"
                    val errMsg = error.message ?: ""
                    if (success) {
                        CrashLogger.log("[ZIM] login SUCCESS: userId=$userId")
                    } else {
                        CrashLogger.log("[ZIM] login FAILED: code=$errCodeName msg=$errMsg")
                    }
                    // Notify the callback (on whatever thread ZIM calls us on —
                    // the ViewModel must hop to the main thread if it needs to).
                    onLoginResult?.invoke(success, errCodeName, errMsg)
                }
            })

            true  // ZIM instance created; login continues in background
        } catch (e: Throwable) {
            initialized = false
            loggedIn = false
            CrashLogger.log("[ZIM] init EXCEPTION: ${e.javaClass.name}: ${e.message}")
            Log.e(TAG, "init exception", e)
            onLoginResult?.invoke(false, "EXCEPTION", "${e.javaClass.simpleName}: ${e.message}")
            false
        }
    }

    fun uninit() {
        try {
            zim?.logout()
        } catch (e: Throwable) {
            CrashLogger.log("[ZIM] logout exception: ${e.message}")
        }
        try {
            zim?.destroy()
        } catch (e: Throwable) {
            CrashLogger.log("[ZIM] destroy exception: ${e.message}")
        }
        zim = null
        initialized = false
        loggedIn = false
        currentUserId = null
        CrashLogger.log("[ZIM] uninit OK")
    }

    // ─── Send Text Message ────────────────────────────────────────────────

    fun sendTextMessage(
        text: String,
        peerUserId: String,
        consultationId: String,
        senderName: String,
        callback: ((success: Boolean, messageId: String?, errorMessage: String?) -> Unit)? = null
    ) {
        val z = zim
        if (z == null || !loggedIn) {
            val msg = "ZIM not logged in (loggedIn=$loggedIn, initialized=$initialized)"
            CrashLogger.log("[ZIM] sendTextMessage FAILED: $msg")
            callback?.invoke(false, null, msg)
            return
        }
        try {
            val zimMsg = ZIMTextMessage(text)
            val config = ZIMMessageSendConfig().apply {
                priority = im.zego.zim.enums.ZIMMessagePriority.LOW
            }
            zimMsg.extendedData = buildExtendedData(consultationId, senderName, "text")

            z.sendMessage(zimMsg, peerUserId, ZIMConversationType.PEER, config,
                object : ZIMMessageSentCallback {
                    override fun onMessageAttached(message: ZIMMessage) {}
                    override fun onMessageSent(message: ZIMMessage, error: ZIMError) {
                        if (error.code == ZIMErrorCode.SUCCESS) {
                            CrashLogger.log("[ZIM] Text sent OK: id=${message.messageID}")
                            callback?.invoke(true, message.messageID.toString(), null)
                        } else {
                            CrashLogger.log("[ZIM] Text send FAILED: code=${error.code} msg=${error.message}")
                            callback?.invoke(false, null, "code=${error.code}: ${error.message}")
                        }
                    }
                })
        } catch (e: Throwable) {
            CrashLogger.log("[ZIM] sendTextMessage exception: ${e.message}")
            callback?.invoke(false, null, e.message ?: "exception")
        }
    }

    // ─── Send Media Messages ──────────────────────────────────────────────

    fun sendImageMessage(
        localFilePath: String,
        peerUserId: String,
        consultationId: String,
        senderName: String,
        callback: ((success: Boolean, errorMessage: String?) -> Unit)? = null
    ) {
        val z = zim
        if (z == null || !loggedIn) {
            callback?.invoke(false, "ZIM not logged in")
            return
        }
        try {
            val zimMsg = ZIMImageMessage(localFilePath)
            zimMsg.extendedData = buildExtendedData(consultationId, senderName, "image")
            val config = ZIMMessageSendConfig().apply { priority = im.zego.zim.enums.ZIMMessagePriority.LOW }
            z.sendMessage(zimMsg, peerUserId, ZIMConversationType.PEER, config,
                object : ZIMMessageSentCallback {
                    override fun onMessageAttached(message: ZIMMessage) {}
                    override fun onMessageSent(message: ZIMMessage, error: ZIMError) {
                        if (error.code == ZIMErrorCode.SUCCESS) {
                            CrashLogger.log("[ZIM] Image sent OK: id=${message.messageID}")
                            callback?.invoke(true, null)
                        } else {
                            CrashLogger.log("[ZIM] Image send FAILED: ${error.code} ${error.message}")
                            callback?.invoke(false, "code=${error.code}: ${error.message}")
                        }
                    }
                })
        } catch (e: Exception) {
            CrashLogger.log("[ZIM] sendImageMessage exception: ${e.message}")
            callback?.invoke(false, e.message)
        }
    }

    fun sendAudioMessage(
        localFilePath: String,
        durationSec: Long,
        peerUserId: String,
        consultationId: String,
        senderName: String,
        callback: ((success: Boolean, errorMessage: String?) -> Unit)? = null
    ) {
        val z = zim
        if (z == null || !loggedIn) {
            callback?.invoke(false, "ZIM not logged in")
            return
        }
        try {
            val zimMsg = ZIMAudioMessage(localFilePath, durationSec)
            zimMsg.extendedData = buildExtendedData(consultationId, senderName, "voice")
            val config = ZIMMessageSendConfig().apply { priority = im.zego.zim.enums.ZIMMessagePriority.LOW }
            z.sendMessage(zimMsg, peerUserId, ZIMConversationType.PEER, config,
                object : ZIMMessageSentCallback {
                    override fun onMessageAttached(message: ZIMMessage) {}
                    override fun onMessageSent(message: ZIMMessage, error: ZIMError) {
                        if (error.code == ZIMErrorCode.SUCCESS) {
                            CrashLogger.log("[ZIM] Audio sent OK: id=${message.messageID}")
                            callback?.invoke(true, null)
                        } else {
                            CrashLogger.log("[ZIM] Audio send FAILED: ${error.code} ${error.message}")
                            callback?.invoke(false, "code=${error.code}: ${error.message}")
                        }
                    }
                })
        } catch (e: Exception) {
            CrashLogger.log("[ZIM] sendAudioMessage exception: ${e.message}")
            callback?.invoke(false, e.message)
        }
    }

    fun sendVideoMessage(
        localFilePath: String,
        durationSec: Long,
        peerUserId: String,
        consultationId: String,
        senderName: String,
        callback: ((success: Boolean, errorMessage: String?) -> Unit)? = null
    ) {
        val z = zim
        if (z == null || !loggedIn) {
            callback?.invoke(false, "ZIM not logged in")
            return
        }
        try {
            val zimMsg = ZIMVideoMessage(localFilePath, durationSec)
            zimMsg.extendedData = buildExtendedData(consultationId, senderName, "video")
            val config = ZIMMessageSendConfig().apply { priority = im.zego.zim.enums.ZIMMessagePriority.LOW }
            z.sendMessage(zimMsg, peerUserId, ZIMConversationType.PEER, config,
                object : ZIMMessageSentCallback {
                    override fun onMessageAttached(message: ZIMMessage) {}
                    override fun onMessageSent(message: ZIMMessage, error: ZIMError) {
                        if (error.code == ZIMErrorCode.SUCCESS) {
                            CrashLogger.log("[ZIM] Video sent OK: id=${message.messageID}")
                            callback?.invoke(true, null)
                        } else {
                            CrashLogger.log("[ZIM] Video send FAILED: ${error.code} ${error.message}")
                            callback?.invoke(false, "code=${error.code}: ${error.message}")
                        }
                    }
                })
        } catch (e: Exception) {
            CrashLogger.log("[ZIM] sendVideoMessage exception: ${e.message}")
            callback?.invoke(false, e.message)
        }
    }

    // ─── Download Media ───────────────────────────────────────────────────

    fun downloadMediaFile(
        message: ZIMMessage,
        targetLocalPath: String,
        callback: ((success: Boolean, localPath: String?, errorMessage: String?) -> Unit)? = null
    ) {
        val z = zim ?: run {
            callback?.invoke(false, null, "ZIM not initialized")
            return
        }
        if (message !is ZIMMediaMessage) {
            callback?.invoke(false, null, "Message is not a media message")
            return
        }
        try {
            message.fileLocalPath = targetLocalPath
            z.downloadMediaFile(message, ZIMMediaFileType.ORIGINAL_FILE,
                object : ZIMMediaDownloadedCallback {
                    override fun onMediaDownloaded(message: ZIMMessage, error: ZIMError) {
                        if (error.code == ZIMErrorCode.SUCCESS) {
                            CrashLogger.log("[ZIM] Media downloaded to: $targetLocalPath")
                            callback?.invoke(true, targetLocalPath, null)
                        } else {
                            CrashLogger.log("[ZIM] Media download FAILED: ${error.code} ${error.message}")
                            callback?.invoke(false, null, "code=${error.code}: ${error.message}")
                        }
                    }
                    override fun onMediaDownloadingProgress(message: ZIMMessage, currentFileSize: Long, totalFileSize: Long) {}
                })
        } catch (e: Exception) {
            CrashLogger.log("[ZIM] downloadMediaFile exception: ${e.message}")
            callback?.invoke(false, null, e.message)
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    private fun buildExtendedData(consultationId: String, senderName: String, messageType: String): String {
        return try {
            JSONObject().apply {
                put("consultationId", consultationId)
                put("senderName", senderName)
                put("messageType", messageType)
            }.toString()
        } catch (e: Exception) {
            "{\"consultationId\":\"$consultationId\",\"senderName\":\"$senderName\",\"messageType\":\"$messageType\"}"
        }
    }

    private fun parseExtendedData(json: String?): Map<String, String> {
        if (json.isNullOrBlank()) return emptyMap()
        return try {
            val obj = JSONObject(json)
            mapOf(
                "consultationId" to (obj.optString("consultationId", "")),
                "senderName" to (obj.optString("senderName", "")),
                "messageType" to (obj.optString("messageType", "text"))
            )
        } catch (e: Exception) {
            emptyMap()
        }
    }

    private fun mapZimMessage(msg: ZIMMessage, fromUserID: String): ZimIncomingMessage? {
        val ext = parseExtendedData(msg.extendedData)
        val consultationId = ext["consultationId"] ?: ""
        val senderName = ext["senderName"] ?: fromUserID
        val messageType = ext["messageType"] ?: "text"

        return when (msg) {
            is ZIMTextMessage -> ZimIncomingMessage(
                consultationId = consultationId,
                senderId = fromUserID,
                senderName = senderName,
                text = msg.message,
                messageType = "text",
                timestamp = msg.timestamp,
                fileUrl = null,
                duration = null,
                fileSize = null,
                zimMessage = msg
            )
            is ZIMAudioMessage -> ZimIncomingMessage(
                consultationId = consultationId,
                senderId = fromUserID,
                senderName = senderName,
                text = "",
                messageType = "voice",
                timestamp = msg.timestamp,
                fileUrl = msg.fileDownloadUrl,
                duration = msg.audioDuration.toInt(),
                fileSize = msg.fileSize,
                zimMessage = msg
            )
            is ZIMImageMessage -> ZimIncomingMessage(
                consultationId = consultationId,
                senderId = fromUserID,
                senderName = senderName,
                text = "",
                messageType = "image",
                timestamp = msg.timestamp,
                fileUrl = msg.fileDownloadUrl,
                duration = null,
                fileSize = msg.fileSize,
                zimMessage = msg
            )
            is ZIMVideoMessage -> ZimIncomingMessage(
                consultationId = consultationId,
                senderId = fromUserID,
                senderName = senderName,
                text = "",
                messageType = "video",
                timestamp = msg.timestamp,
                fileUrl = msg.fileDownloadUrl,
                duration = msg.videoDuration.toInt(),
                fileSize = msg.fileSize,
                zimMessage = msg
            )
            is ZIMFileMessage -> ZimIncomingMessage(
                consultationId = consultationId,
                senderId = fromUserID,
                senderName = senderName,
                text = "",
                messageType = "file",
                timestamp = msg.timestamp,
                fileUrl = msg.fileDownloadUrl,
                duration = null,
                fileSize = msg.fileSize,
                zimMessage = msg
            )
            else -> null
        }
    }

    // -- Call Signaling via ZIM --
    fun sendCallSignal(toUserId: String, roomId: String, callType: String, callerId: String, callerName: String) {
        val z = zim ?: return
        val json = "\u007b\u0022type\u0022:\u0022call_signal\u0022,\u0022roomId\u0022:\u0022" + roomId + "\u0022,\u0022callType\u0022:\u0022" + callType + "\u0022,\u0022callerId\u0022:\u0022" + callerId + "\u0022,\u0022callerName\u0022:\u0022" + callerName + "\u0022\u007d"
        val message = ZIMTextMessage(json)
        z.sendMessage(message, toUserId, ZIMConversationType.PEER, ZIMMessageSendConfig(), object : ZIMMessageSentCallback { override fun onMessageAttached(message: ZIMMessage) {} override fun onMessageSent(message: ZIMMessage, error: ZIMError) {} })
    }
}

data class ZimIncomingMessage(
    val consultationId: String,
    val senderId: String,
    val senderName: String,
    val text: String,
    val messageType: String,
    val timestamp: Long,
    val fileUrl: String?,
    val duration: Int?,
    val fileSize: Long?,
    val zimMessage: ZIMMessage
)
