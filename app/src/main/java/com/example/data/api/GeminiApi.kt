package com.example.data.api

import com.squareup.moshi.FromJson
import com.squareup.moshi.Json
import com.squareup.moshi.ToJson
import com.squareup.moshi.JsonClass
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import retrofit2.http.*
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import retrofit2.http.Multipart

// ─── API Data Classes ─────────────────────────────────────────────────────────

@JsonClass(generateAdapter = true)
data class LoginRequest(
    val username: String,
    val password: String
)

@JsonClass(generateAdapter = true)
data class RegisterRequest(
    val username: String,
    val password: String,
    val name: String,
    val email: String = "",
    val phone: String = "",
    val age: Any? = null,
    val gender: String = "Homme"
)

@JsonClass(generateAdapter = true)
data class LoginResponse(
    val token: String,
    val user: UserDto
)

@JsonClass(generateAdapter = true)
data class UserDto(
    val id: String,
    val username: String,
    val role: String,
    val name: String,
    val email: String? = null,
    val phone: String? = null,
    val age: Any? = null,
    val gender: String? = null,
    val specialty: String? = null,
    val license_number: String? = null,
    val location: String? = null,
    val hospital: String? = null,
    val biography: String? = null,
    val avatar_url: String? = null,
    val rating: Double? = null,
    val is_available: Int? = 1
)

@JsonClass(generateAdapter = true)
data class CreateConsultationRequest(
    val description: String,
    val specialtyNeeded: String,
    val urgencyLevel: String,
    val aiSummary: String,
    val aiExplanation: String,
    val doctorId: String? = null,
    val patientAge: Int? = null,
    val transactionId: String? = null,
    val paymentAmount: Int? = null,
    val orderId: String? = null
)

@JsonClass(generateAdapter = true)
data class PrescriptionRequest(
    val prescription: String
)

@JsonClass(generateAdapter = true)
data class ServerMessage(
    val id: Long,
    val consultation_id: String,
    val sender_id: String,
    val sender_name: String,
    val text: String,
    val created_at: Long? = null,
    val message_type: String? = null,
    val file_url: String? = null,
    val duration: Int? = null,
    val file_size: Long? = null
)

// ─── LiveKit Token ────────────────────────────────────────────────────────────

@JsonClass(generateAdapter = true)
data class CallTokenRequest(
    val consultationId: String,
    val isVideo: Boolean
)

@JsonClass(generateAdapter = true)
data class CallTokenResponse(
    val token: String,
    val url: String,
    val roomName: String,
    val participantIdentity: String
)

// ─── Incoming Call Event (via main WebSocket, no SDP) ────────────────────────

data class IncomingCallEvent(
    val from: String,
    val fromName: String,
    val consultationId: String,
    val callType: String,  // "voice" or "video"
    val roomName: String,
    val timestamp: Long
)

// ─── WebSocket event types ─────────────────────────────────────────────────

data class WsNewMessage(
    val type: String = "message:new",
    val id: Long,
    val consultationId: String,
    val senderId: String,
    val senderName: String,
    val text: String,
    val timestamp: Long,
    val messageType: String = "text",
    val fileUrl: String? = null,
    val duration: Int? = null,
    val fileSize: Long? = null
)

data class WsConsultationUpdated(
    val type: String = "consultation:updated",
    val id: String,
    val status: String,
    val doctor_id: String?
)

data class WsTyping(
    val type: String = "typing",
    val consultationId: String,
    val senderId: String,
    val isTyping: Boolean
)

data class WsNewConsultation(
    val type: String = "consultation:new",
    val id: String,
    val patientName: String,
    val description: String,
    val specialtyNeeded: String,
    val urgencyLevel: String
)

// ─── Medika REST API ─────────────────────────────────────────────────────────



@JsonClass(generateAdapter = true)
data class SpecialtyPriceItem(
    val id: String,
    val name: String,
    val price: Int
)


@JsonClass(generateAdapter = true)
data class PriceResponse(
    val specialty: String,
    val price: Int
)


// ─── Medical History & Consultation Notes ────────────────────────────────────

@JsonClass(generateAdapter = true)
data class ConsultationNote(
    val consultation_id: String = "",
    val patient_id: String = "",
    val doctor_id: String = "",
    val doctor_name: String? = null,
    val diagnosis: String = "",
    val symptoms: String = "",
    val notes: String = "",
    val prescriptions: List<PrescriptionItem> = emptyList(),
    val follow_up: String = "",
    val flag_allergy: Boolean = false,
    val created_at: Long? = null,
    val updated_at: Long? = null
)

@JsonClass(generateAdapter = true)
data class PrescriptionItem(
    val medication: String = "",
    val dosage: String = "",
    val duration: String = ""
)

@JsonClass(generateAdapter = true)
data class SaveConsultationNoteRequest(
    val diagnosis: String = "",
    val symptoms: String = "",
    val notes: String = "",
    val prescriptions: List<PrescriptionItem> = emptyList(),
    val followUp: String = "",
    val flagAllergy: Boolean = false
)

@JsonClass(generateAdapter = true)
data class MedicalHistory(
    val patient_id: String = "",
    val patient_name: String? = null,
    val created_at: Long? = null,
    val last_updated: Long? = null,
    val basic_info: BasicInfo? = null,
    val allergies: List<AllergyItem> = emptyList(),
    val chronic_conditions: List<ChronicConditionItem> = emptyList(),
    val current_medications: List<MedicationItem> = emptyList(),
    val vaccinations: List<VaccinationItem> = emptyList(),
    val emergency_contact: EmergencyContactItem? = null,
    val surgical_history: List<SurgicalHistoryItem> = emptyList(),
    val consultation_timeline: List<ConsultationTimelineItem> = emptyList()
)

@JsonClass(generateAdapter = true)
data class BasicInfo(
    val bloodType: String? = null,
    val weight: Double? = null,
    val height: Double? = null
)

@JsonClass(generateAdapter = true)
data class AllergyItem(
    val name: String = "",
    val severity: String = "",
    val reaction: String = "",
    val notedAt: String? = null
)

@JsonClass(generateAdapter = true)
data class ChronicConditionItem(
    val name: String = "",
    val diagnosed_at: String? = null,
    val status: String = "",
    val notes: String = "",
    val source: String? = null
)

@JsonClass(generateAdapter = true)
data class MedicationItem(
    val name: String = "",
    val dosage: String = "",
    val since: String? = null,
    val prescribed_by: String? = null,
    val source: String? = null
)

@JsonClass(generateAdapter = true)
data class VaccinationItem(
    val name: String = "",
    val date: String? = null,
    val doseNumber: Int? = null
)

@JsonClass(generateAdapter = true)
data class EmergencyContactItem(
    val name: String = "",
    val relationship: String = "",
    val phone: String = ""
)

@JsonClass(generateAdapter = true)
data class SurgicalHistoryItem(
    val procedure: String = "",
    val date: String? = null,
    val hospital: String = ""
)

@JsonClass(generateAdapter = true)
data class ConsultationTimelineItem(
    val consultation_id: String = "",
    val date: String? = null,
    val doctor_name: String = "",
    val specialty: String = "",
    val diagnosis: String = "",
    val summary: String = "",
    val prescriptions: List<String> = emptyList()
)

@JsonClass(generateAdapter = true)
data class MedicalHistorySnapshot(
    val patient_id: String = "",
    val patient_name: String? = null,
    val has_allergies: Boolean = false,
    val allergies: List<AllergyItem> = emptyList(),
    val chronic_conditions: List<ChronicConditionItem> = emptyList(),
    val current_medications: List<MedicationItem> = emptyList(),
    val recent_consultations: Int = 0
)

@JsonClass(generateAdapter = true)
data class UpdateMedicalHistoryRequest(
    val basicInfo: BasicInfo? = null,
    val allergies: List<AllergyItem>? = null,
    val chronicConditions: List<ChronicConditionItem>? = null,
    val currentMedications: List<MedicationItem>? = null,
    val vaccinations: List<VaccinationItem>? = null,
    val emergencyContact: EmergencyContactItem? = null,
    val surgicalHistory: List<SurgicalHistoryItem>? = null
)


interface MedikaApiService {

    @POST("api/auth/login")
    suspend fun login(@Body request: LoginRequest): LoginResponse

    @POST("api/auth/register")
    suspend fun register(@Body request: RegisterRequest): LoginResponse

    @GET("api/consultations")
    suspend fun getConsultations(@Header("Authorization") token: String): List<Map<String, Any?>>

    @GET("api/consultations/{id}")
    suspend fun getConsultation(@Header("Authorization") token: String, @Path("id") id: String): Map<String, Any?>?

    @GET("api/consultations/{id}/messages")
    suspend fun getMessages(@Header("Authorization") token: String, @Path("id") consultationId: String): List<ServerMessage>

    @POST("api/consultations")
    suspend fun createConsultation(@Header("Authorization") token: String, @Body request: CreateConsultationRequest): Map<String, Any?>

    @PUT("api/consultations/{id}/accept")
    suspend fun acceptConsultation(@Header("Authorization") token: String, @Path("id") id: String): Map<String, Any?>

    @PUT("api/consultations/{id}/reject")
    suspend fun rejectConsultation(@Header("Authorization") token: String, @Path("id") id: String): Map<String, Any?>

    @PUT("api/consultations/{id}/prescription")
    suspend fun writePrescription(@Header("Authorization") token: String, @Path("id") id: String, @Body request: PrescriptionRequest): Map<String, Any?>

    @GET("api/profile")
    suspend fun getProfile(@Header("Authorization") token: String): UserDto

    @PUT("api/profile")
    suspend fun updateProfile(@Header("Authorization") token: String, @Body body: UpdateProfileRequest): UserDto

    @PUT("api/doctor/availability")
    suspend fun updateAvailability(@Header("Authorization") token: String, @Body body: Map<String, Any>): Map<String, Any>

    @GET("api/doctors")
    suspend fun getDoctors(@Header("Authorization") token: String): List<UserDto>

    @GET("api/doctors")
    suspend fun getDoctorsBySpecialty(@Header("Authorization") token: String, @Query("specialty") specialty: String): List<UserDto>

    @GET("api/health")
    suspend fun health(): Map<String, String>

    // ─── Admin endpoints ───────────────────────────────
    @POST("api/admin/auth/login")
    suspend fun adminLogin(@Body request: LoginRequest): LoginResponse

    @GET("api/admin/doctors")
    suspend fun adminGetDoctors(@Header("Authorization") token: String): List<Map<String, Any?>>

    @GET("api/admin/consultations")
    suspend fun adminGetConsultations(@Header("Authorization") token: String): List<Map<String, Any?>>

    @GET("api/admin/patients")
    suspend fun adminGetPatients(@Header("Authorization") token: String): List<Map<String, Any?>>

    @POST("api/admin/doctors")
    suspend fun adminCreateDoctorApi(@Header("Authorization") token: String, @Body body: Map<String, Any?>): Map<String, Any?>

    // ─── LiveKit Token ────────────────────────────────────────────────────────

    @POST("api/call/token")
    suspend fun getCallToken(@Header("Authorization") token: String, @Body request: CallTokenRequest): CallTokenResponse

    @Multipart
    @POST("api/upload")
    suspend fun uploadFile(
        @Header("Authorization") token: String,
        @Part file: okhttp3.MultipartBody.Part,
        @Query("type") type: String = "media",
        @Query("consultationId") consultationId: String? = null
    ): UploadResponse

    // ─── Support Tickets ──────────────────────────────────────────────
    @GET("api/tickets")
    suspend fun getTickets(@Header("Authorization") token: String): List<Map<String, Any?>>

    @POST("api/tickets")
    suspend fun createTicket(@Header("Authorization") token: String, @Body body: CreateTicketRequest): Map<String, Any?>

    @GET("api/tickets/{id}")
    suspend fun getTicket(@Header("Authorization") token: String, @Path("id") id: String): Map<String, Any?>

    @POST("api/tickets/{id}/messages")
    suspend fun sendTicketMessage(@Header("Authorization") token: String, @Path("id") id: String, @Body body: SendMessageRequest): Map<String, Any?>

    @POST("api/upload")
    suspend fun uploadTicketFile(
        @Header("Authorization") token: String,
        @Part file: okhttp3.MultipartBody.Part,
        @Query("type") type: String = "media"
    ): UploadResponse
    @GET("api/specialties/prices")
    suspend fun getSpecialtyPrices(@Header("Authorization") token: String): List<SpecialtyPriceItem>

    // ─── Medical History & Consultation Notes ─────────────────────────
    @GET("api/consultations/{id}/notes")
    suspend fun getConsultationNotes(@Header("Authorization") token: String, @Path("id") consultationId: String): ConsultationNote?

    @PUT("api/consultations/{id}/notes")
    suspend fun saveConsultationNotes(@Header("Authorization") token: String, @Path("id") consultationId: String, @Body body: SaveConsultationNoteRequest): ConsultationNote

    @GET("api/medical-history/{patientId}")
    suspend fun getMedicalHistory(@Header("Authorization") token: String, @Path("patientId") patientId: String): MedicalHistory

    @GET("api/medical-history/{patientId}/snapshot")
    suspend fun getMedicalHistorySnapshot(@Header("Authorization") token: String, @Path("patientId") patientId: String): MedicalHistorySnapshot

    @PUT("api/medical-history/{patientId}")
    suspend fun updateMedicalHistory(@Header("Authorization") token: String, @Path("patientId") patientId: String, @Body body: UpdateMedicalHistoryRequest): MedicalHistory

}

@JsonClass(generateAdapter = true)
data class UpdateProfileRequest(
    val name: String? = null,
    val email: String? = null,
    val phone: String? = null,
    val age: Any? = null,
    val gender: String? = null,
    val specialty: String? = null,
    val licenseNumber: String? = null,
    val hospital: String? = null,
    val biography: String? = null,
    val location: String? = null,
    val avatarUrl: String? = null
)

@JsonClass(generateAdapter = true)
data class CreateTicketRequest(
    val subject: String
)

@JsonClass(generateAdapter = true)
data class SendMessageRequest(
    val content: String,
    val file_url: String? = null,
    val file_type: String? = null,
    val file_size: Long? = null
)

@JsonClass(generateAdapter = true)
data class UploadResponse(
    val url: String,
    val filename: String,
    val mimetype: String,
    val size: Long
)

// ─── Singleton Clients ───────────────────────────────────────────────────────


object MedikaNetwork {

    const val BASE_URL = "https://medikahaiti.site/"

    // KotlinJsonAdapterFactory handles Int? nullables natively.
    // Removed SafeIntJsonAdapter to prevent recursive adapter resolution bug.
    private val moshi = Moshi.Builder()
        .addLast(KotlinJsonAdapterFactory())
        .build()

    val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BASIC
            })
            .build()
    }

    val api: MedikaApiService by lazy {
        Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
            .create(MedikaApiService::class.java)
    }

    // ─── WebSocket Manager ───────────────────────────────────────────────

    private var webSocket: WebSocket? = null
    private var currentUserId: String? = null
    var authToken: String? = null
    var onMessageReceived: ((WsNewMessage) -> Unit)? = null
    var onTypingReceived: ((WsTyping) -> Unit)? = null
    var onConsultationUpdated: ((WsConsultationUpdated) -> Unit)? = null
    var onNewConsultation: ((WsNewConsultation) -> Unit)? = null
    var onConnectionChanged: ((Boolean) -> Unit)? = null

    // ─── Call events (replaces old signaling server) ────────────────────
    var onIncomingCall: ((IncomingCallEvent) -> Unit)? = null
    var onCallAccepted: ((consultationId: String, from: String) -> Unit)? = null
    var onCallRejected: ((consultationId: String) -> Unit)? = null
    var onCallEnded: ((consultationId: String) -> Unit)? = null

    fun connectWebSocket(userId: String) {
        disconnectWebSocket()
        currentUserId = userId

        val request = Request.Builder()
            .url("${BASE_URL}ws")
            .build()

        webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                val authMsg = """{"type":"auth","userId":"$userId"}"""
                webSocket.send(authMsg)
                onConnectionChanged?.invoke(true)
                println("[WS] Connected and authenticated as $userId")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = org.json.JSONObject(text)
                    when (json.getString("type")) {
                        "message:new" -> {
                            val msg = WsNewMessage(
                                type = "message:new",
                                id = json.getLong("id"),
                                consultationId = json.getString("consultationId"),
                                senderId = json.getString("senderId"),
                                senderName = json.getString("senderName"),
                                text = if (json.has("text")) json.getString("text") else "",
                                timestamp = json.getLong("timestamp"),
                                messageType = if (json.has("messageType")) json.getString("messageType") else "text",
                                fileUrl = if (json.has("fileUrl") && !json.isNull("fileUrl")) json.getString("fileUrl") else null,
                                duration = if (json.has("duration") && !json.isNull("duration")) json.getInt("duration") else null,
                                fileSize = if (json.has("fileSize") && !json.isNull("fileSize")) json.getLong("fileSize") else null
                            )
                            onMessageReceived?.invoke(msg)
                        }
                        "typing" -> {
                            val typing = WsTyping(
                                consultationId = json.getString("consultationId"),
                                senderId = json.getString("senderId"),
                                isTyping = json.optBoolean("isTyping", true)
                            )
                            onTypingReceived?.invoke(typing)
                        }
                        "consultation:updated" -> {
                            val updated = WsConsultationUpdated(
                                id = json.getString("id"),
                                status = json.getString("status"),
                                doctor_id = json.optString("doctor_id", null)
                            )
                            onConsultationUpdated?.invoke(updated)
                        }
                        "consultation:new" -> {
                            val newC = WsNewConsultation(
                                id = json.getString("id"),
                                patientName = json.getString("patientName"),
                                description = json.getString("description"),
                                specialtyNeeded = json.getString("specialtyNeeded"),
                                urgencyLevel = json.getString("urgencyLevel")
                            )
                            onNewConsultation?.invoke(newC)
                        }
                        // ─── Call signaling via main WS ─────────────────────
                        "call:incoming" -> {
                            val event = IncomingCallEvent(
                                from = json.getString("from"),
                                fromName = json.getString("fromName"),
                                consultationId = json.getString("consultationId"),
                                callType = json.getString("callType"),
                                roomName = json.getString("roomName"),
                                timestamp = json.getLong("timestamp")
                            )
                            println("[WS] Incoming call from ${event.fromName} (${event.callType})")
                            onIncomingCall?.invoke(event)
                        }
                        "call:accepted" -> {
                            val consultationId = json.getString("consultationId")
                            val from = json.getString("from")
                            println("[WS] Call accepted in $consultationId by $from")
                            onCallAccepted?.invoke(consultationId, from)
                        }
                        "call:rejected" -> {
                            val consultationId = json.getString("consultationId")
                            println("[WS] Call rejected in $consultationId")
                            onCallRejected?.invoke(consultationId)
                        }
                        "call:ended" -> {
                            val consultationId = json.getString("consultationId")
                            println("[WS] Call ended in $consultationId")
                            onCallEnded?.invoke(consultationId)
                        }
                    }
                } catch (e: Exception) {
                    println("[WS] Error parsing message: ${e.message}")
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                onConnectionChanged?.invoke(false)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
                println("[WS] Disconnected: ${t.message}")
                onConnectionChanged?.invoke(false)
                if (currentUserId != null) {
                    Thread {
                        try { Thread.sleep(3000) } catch (_: InterruptedException) {}
                        if (currentUserId != null) connectWebSocket(currentUserId!!)
                    }.start()
                }
            }
        })
    }

    fun sendMessage(consultationId: String, senderId: String, senderName: String, text: String, messageType: String = "text", fileUrl: String? = null, duration: Int? = null, fileSize: Long? = null): Boolean {
        val esc = text.replace("\"", "\\\"").replace("\n", "\\n")
        val fup = if (fileUrl != null) ",\"fileUrl\":\"" + fileUrl + "\"" else ""
        val dup = if (duration != null) ",\"duration\":" + duration else ""
        val fsp = if (fileSize != null) ",\"fileSize\":" + fileSize else ""
        val msg = "{\"type\":\"message:send\",\"consultationId\":\"" + consultationId + "\",\"senderId\":\"" + senderId + "\",\"senderName\":\"" + senderName + "\",\"text\":\"" + esc + "\",\"messageType\":\"" + messageType + "\"" + fup + dup + fsp + "}"
        val ws = webSocket
        if (ws == null) {
            println("[WS] FAIL: webSocket is null — not connected")
            return false
        }
        val ok = ws.send(msg)
        println("[WS] sendMessage(type=$messageType, ok=$ok)")
        return ok
    }

    /**
     * Result of an upload attempt. On failure, [errorMessage] carries a
     * human-readable reason that the UI can surface as a Toast.
     */
    data class UploadResult(
        val success: Boolean,
        val response: UploadResponse? = null,
        val errorMessage: String? = null
    )

    /**
     * Suspend upload using the Retrofit @Multipart endpoint. Detects the proper
     * MIME type from the file extension, builds a MultipartBody.Part, and
     * surfaces a human-readable error on failure.
     */
    suspend fun uploadFileSuspending(
        filePath: String,
        type: String = "media",
        consultationId: String? = null
    ): UploadResult {
        val token = authToken
        if (token == null) {
            val msg = "Non connecte (jeton manquant)"
            println("[UPLOAD] FAIL: $msg")
            return UploadResult(false, errorMessage = msg)
        }
        val file = java.io.File(filePath)
        if (!file.exists()) {
            val msg = "Fichier introuvable: $filePath"
            println("[UPLOAD] FAIL: $msg")
            return UploadResult(false, errorMessage = msg)
        }
        if (file.length() == 0L) {
            val msg = "Fichier vide: $filePath"
            println("[UPLOAD] FAIL: $msg")
            return UploadResult(false, errorMessage = msg)
        }

        val mimeType = guessMimeType(file.name)
        println("[UPLOAD] Starting: ${file.name} (${file.length() / 1024}KB, mime=$mimeType, type=$type, cons=$consultationId)")

        return try {
            // Build the multipart part with the proper content type.
            val requestFile = file.asRequestBody(mimeType.toMediaType())
            val multipartPart = okhttp3.MultipartBody.Part.createFormData(
                "file", file.name, requestFile
            )
            val response = api.uploadFile(token, multipartPart, type, consultationId)
            println("[UPLOAD] OK: url=${response.url} size=${response.size}")
            UploadResult(true, response = response)
        } catch (e: retrofit2.HttpException) {
            val errBody = try {
                e.response()?.errorBody()?.string()?.take(500) ?: "<no body>"
            } catch (_: Exception) { "<no body>" }
            val msg = "Erreur serveur ${e.code()}: $errBody"
            println("[UPLOAD] FAIL: $msg")
            UploadResult(false, errorMessage = msg)
        } catch (e: java.net.SocketTimeoutException) {
            val msg = "Delai d'attente depasse (timeout)"
            println("[UPLOAD] FAIL: $msg")
            UploadResult(false, errorMessage = msg)
        } catch (e: java.net.ConnectException) {
            val msg = "Impossible de joindre le serveur"
            println("[UPLOAD] FAIL: $msg — ${e.message}")
            UploadResult(false, errorMessage = msg)
        } catch (e: Exception) {
            val msg = "${e.javaClass.simpleName}: ${e.message ?: "erreur inconnue"}"
            println("[UPLOAD] FAIL: $msg")
            UploadResult(false, errorMessage = msg)
        }
    }

    /** Map common file extensions to MIME types so the backend's fileFilter accepts them. */
    private fun guessMimeType(fileName: String): String {
        val ext = fileName.substringAfterLast('.', "").lowercase()
        return when (ext) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "mp4" -> "video/mp4"
            "3gp" -> "video/3gp"
            "webm" -> "video/webm"
            "m4a", "aac" -> "audio/mp4"
            "mp3" -> "audio/mpeg"
            "wav" -> "audio/wav"
            "ogg" -> "audio/ogg"
            else -> "application/octet-stream"
        }
    }

    /** Legacy synchronous wrapper — kept for compatibility, but prefer uploadFileSuspending. */
    fun uploadFile(filePath: String, type: String = "media", consultationId: String? = null): UploadResponse? {
        val token = authToken ?: run {
            println("[UPLOAD] FAIL: authToken is null")
            return null
        }
        val file = java.io.File(filePath)
        if (!file.exists()) {
            println("[UPLOAD] FAIL: file does not exist at $filePath")
            return null
        }
        if (file.length() == 0L) {
            println("[UPLOAD] FAIL: file is empty at $filePath")
            return null
        }
        println("[UPLOAD] Starting (sync): ${file.name} (${file.length() / 1024}KB)")
        val mimeType = guessMimeType(file.name)
        val requestBody = okhttp3.MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("file", file.name, file.asRequestBody(mimeType.toMediaType()))
            .build()
        val url = if (consultationId != null) {
            "${BASE_URL}api/upload?type=$type&consultationId=$consultationId"
        } else {
            "${BASE_URL}api/upload?type=$type"
        }
        val request = Request.Builder()
            .url(url)
            .post(requestBody)
            .addHeader("Authorization", token)
            .build()
        return try {
            val response = okHttpClient.newCall(request).execute()
            if (!response.isSuccessful) {
                val errBody = response.body?.string()?.take(500) ?: "<no body>"
                println("[UPLOAD] FAIL: HTTP ${response.code} ${response.message} — $errBody")
                return null
            }
            val body = response.body?.string() ?: run {
                println("[UPLOAD] FAIL: empty response body")
                return null
            }
            val parsed = try {
                val moshi = Moshi.Builder().addLast(KotlinJsonAdapterFactory()).build()
                val adapter = moshi.adapter(UploadResponse::class.java)
                adapter.fromJson(body)
            } catch (e: Exception) {
                println("[UPLOAD] FAIL: parse error: ${e.message} — body: ${body.take(500)}")
                null
            }
            if (parsed != null) println("[UPLOAD] OK: url=${parsed.url}")
            parsed
        } catch (e: Exception) {
            println("[UPLOAD] FAIL: exception: ${e.javaClass.simpleName}: ${e.message}")
            null
        }
    }

    fun sendTyping(consultationId: String, isTyping: Boolean) {
        val userId = currentUserId ?: return
        val msg = "{\"type\":\"typing\",\"consultationId\":\"" + consultationId + "\",\"senderId\":\"" + userId + "\",\"isTyping\":" + isTyping + "}"
        webSocket?.send(msg)
    }

    // ─── Call signaling via main WebSocket ──────────────────────────────

    fun sendCallStart(consultationId: String, callType: String, roomName: String, callerName: String) {
        val userId = currentUserId ?: return
        val ts = System.currentTimeMillis()
        val escapedName = callerName.replace("\"", "\\\"")
        val msg = "{\"type\":\"call:start\",\"consultationId\":\"$consultationId\",\"callType\":\"$callType\",\"roomName\":\"$roomName\",\"callerName\":\"$escapedName\",\"timestamp\":$ts}"
        webSocket?.send(msg)
        println("[WS] Sent call:start for $consultationId")
    }

    fun sendCallAccept(consultationId: String) {
        val userId = currentUserId ?: return
        val ts = System.currentTimeMillis()
        val msg = "{\"type\":\"call:accept\",\"consultationId\":\"$consultationId\",\"timestamp\":$ts}"
        webSocket?.send(msg)
        println("[WS] Sent call:accept for $consultationId")
    }

    fun sendCallReject(consultationId: String) {
        val userId = currentUserId ?: return
        val ts = System.currentTimeMillis()
        val msg = "{\"type\":\"call:reject\",\"consultationId\":\"$consultationId\",\"timestamp\":$ts}"
        webSocket?.send(msg)
        println("[WS] Sent call:reject for $consultationId")
    }

    fun sendCallEnd(consultationId: String) {
        val userId = currentUserId ?: return
        val ts = System.currentTimeMillis()
        val msg = "{\"type\":\"call:end\",\"consultationId\":\"$consultationId\",\"timestamp\":$ts}"
        webSocket?.send(msg)
        println("[WS] Sent call:end for $consultationId")
    }

    fun disconnectWebSocket() {
        currentUserId = null
        webSocket?.close(1000, "logout")
        webSocket = null
    }
}