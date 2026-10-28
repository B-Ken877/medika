package com.example.data.db

import android.content.Context
import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "doctors")
data class DoctorEntity(
    @PrimaryKey val id: String,
    val name: String,
    val specialty: String,
    val licenseNumber: String,
    val location: String,
    val avatarUrl: String,
    val rating: Double,
    val isAvailable: Boolean = true,
    val hospital: String,
    val biography: String
)

@Entity(tableName = "consultations")
data class ConsultationEntity(
    @PrimaryKey val id: String,
    val patientName: String,
    val patientAge: Int,
    val description: String,
    val specialtyNeeded: String,
    val urgencyLevel: String,
    val aiSummary: String,
    val aiExplanation: String,
    val doctorId: String?,
    val status: String,
    val timestamp: Long = System.currentTimeMillis(),
    val prescription: String? = null,
    // Patient's server user ID — needed for Zego call invitations (the callee's
    // Zego user ID must match the one used to init ZegoUIKitPrebuiltCallService).
    val patientId: String? = null
)

@Entity(
    tableName = "messages",
    indices = [Index(value = ["consultationId", "senderId", "timestamp"], unique = true)]
)
data class MessageEntity(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val consultationId: String,
    val senderId: String,
    val senderName: String,
    val text: String,
    val timestamp: Long = System.currentTimeMillis(),
    val messageType: String = "text",
    val fileUrl: String? = null,
    val duration: Int? = null,
    val fileSize: Long? = null,
    // Local-first architecture: a local copy of the file (voice/image/video)
    // stored under filesDir/medika/{consultationId}/. When set, the bubble
    // renders/plays from this path offline.
    val localFilePath: String? = null,
    // "sending" | "sent" | "failed" — only meaningful for outgoing voice/media
    // messages. null for incoming or text messages.
    val sendStatus: String? = null
)

@Entity(tableName = "patient_profile")
data class PatientProfileEntity(
    @PrimaryKey val id: String = "current_patient",
    val name: String,
    val email: String,
    val phone: String,
    val age: Int,
    val gender: String,
    val allergies: String = "",
    val medications: String = "",
    val history: String = ""
)

@Dao
interface SanteDao {
    @Query("SELECT * FROM doctors")
    fun getAllDoctorsFlow(): Flow<List<DoctorEntity>>

    @Query("SELECT * FROM doctors")
    suspend fun getAllDoctors(): List<DoctorEntity>

    @Query("SELECT * FROM doctors WHERE id = :id")
    suspend fun getDoctorById(id: String): DoctorEntity?

    @Query("SELECT * FROM doctors WHERE specialty = :specialty AND isAvailable = 1")
    suspend fun getAvailableDoctorsBySpecialty(specialty: String): List<DoctorEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDoctors(doctors: List<DoctorEntity>)

    @Update
    suspend fun updateDoctor(doctor: DoctorEntity)

    @Query("SELECT * FROM consultations ORDER BY timestamp DESC")
    fun getAllConsultations(): Flow<List<ConsultationEntity>>

    @Query("SELECT * FROM consultations WHERE id = :id")
    suspend fun getConsultationById(id: String): ConsultationEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertConsultation(consultation: ConsultationEntity)

    @Update
    suspend fun updateConsultation(consultation: ConsultationEntity)

    @Query("SELECT * FROM messages WHERE consultationId = :consultationId ORDER BY timestamp ASC")
    fun getMessagesForConsultation(consultationId: String): Flow<List<MessageEntity>>

    @Query("SELECT * FROM messages WHERE consultationId = :consultationId ORDER BY timestamp ASC")
    suspend fun getMessagesForConsultationOnce(consultationId: String): List<MessageEntity>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertMessageIgnore(message: MessageEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: MessageEntity)

    @Query("DELETE FROM messages WHERE consultationId = :consultationId")
    suspend fun deleteMessagesForConsultation(consultationId: String)

    @Query("DELETE FROM messages WHERE id = :id")
    suspend fun deleteMessage(id: Int)

    // Local-first support: update an existing message's send status, server
    // fileUrl, and/or local file path. Used after upload completes (success
    // or failure) and after a received file has been auto-downloaded.
    @Query("UPDATE messages SET sendStatus = :status, fileUrl = :fileUrl, localFilePath = :localFilePath WHERE id = :id")
    suspend fun updateMessageStatus(id: Int, status: String?, fileUrl: String?, localFilePath: String?)

    @Query("UPDATE messages SET localFilePath = :localFilePath, fileSize = :fileSize WHERE id = :id")
    suspend fun updateMessageLocalFile(id: Int, localFilePath: String?, fileSize: Long?)

    @Query("SELECT * FROM messages WHERE id = :id")
    suspend fun getMessageById(id: Int): MessageEntity?

    @Query("SELECT * FROM patient_profile WHERE id = 'current_patient'")
    fun getPatientProfileFlow(): Flow<PatientProfileEntity?>

    @Query("SELECT * FROM patient_profile WHERE id = 'current_patient'")
    suspend fun getPatientProfile(): PatientProfileEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPatientProfile(profile: PatientProfileEntity)
}

@Database(
    entities = [DoctorEntity::class, ConsultationEntity::class, MessageEntity::class, PatientProfileEntity::class],
    version = 4,
    exportSchema = false
)
abstract class SanteDatabase : RoomDatabase() {
    abstract fun santeDao(): SanteDao

    companion object {
        @Volatile
        private var INSTANCE: SanteDatabase? = null

        fun getDatabase(context: Context): SanteDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    SanteDatabase::class.java,
                    "sante_lien_database"
                )
                .fallbackToDestructiveMigration()
                .build()
                INSTANCE = instance
                instance
            }
        }
    }
}