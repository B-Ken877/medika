package com.example.data.repository

import com.example.data.db.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

class SanteRepository(private val dao: SanteDao) {

    val allDoctors: Flow<List<DoctorEntity>> = dao.getAllDoctorsFlow()
    val allConsultations: Flow<List<ConsultationEntity>> = dao.getAllConsultations()
    val patientProfile: Flow<PatientProfileEntity?> = dao.getPatientProfileFlow()

    suspend fun initializeDoctorsIfEmpty() = withContext(Dispatchers.IO) {
        val existing = dao.getAllDoctors()
        if (existing.isEmpty()) {
            val defaultDoctors = listOf(
                DoctorEntity(
                    id = "doc_1", name = "Dr. Jean-Baptiste Fils-Aime",
                    specialty = "Cardiologie", licenseNumber = "MSPP-87241",
                    location = "Port-au-Prince, Haiti",
                    avatarUrl = "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&q=80&w=200",
                    rating = 4.9, isAvailable = true,
                    hospital = "Clinique du Coeur de Delmas",
                    biography = "Specialiste en cardiologie interventionnelle avec plus de 15 ans d'experience dans les soins cardiovasculaires en Haiti."
                ),
                DoctorEntity(
                    id = "doc_2", name = "Dr. Marie-Louise Chery",
                    specialty = "Pediatrie", licenseNumber = "MSPP-91024",
                    location = "Cap-Haitien, Haiti",
                    avatarUrl = "https://images.unsplash.com/photo-1594824813573-246434de83fb?auto=format&fit=crop&q=80&w=200",
                    rating = 4.8, isAvailable = true,
                    hospital = "Hopital Universitaire Justinien",
                    biography = "Dediee a la sante infantile et neonatale dans le Nord."
                ),
                DoctorEntity(
                    id = "doc_3", name = "Dr. Guerda Pierre-Louis",
                    specialty = "Gynecologie", licenseNumber = "MSPP-32104",
                    location = "Port-au-Prince, Haiti",
                    avatarUrl = "https://images.unsplash.com/photo-1591604021695-0c69b7c05981?auto=format&fit=crop&q=80&w=200",
                    rating = 4.7, isAvailable = true,
                    hospital = "Maternite de l'Hopital General",
                    biography = "Specialisee en obstetrique et suivi de grossesse a risque."
                ),
                DoctorEntity(
                    id = "doc_4", name = "Dr. Frantz Clervaux",
                    specialty = "Dermatologie", licenseNumber = "MSPP-55410",
                    location = "Jacmel, Haiti",
                    avatarUrl = "https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&q=80&w=200",
                    rating = 4.9, isAvailable = true,
                    hospital = "Clinique Dermatologique du Sud-Est",
                    biography = "Expert en pathologies de la peau en climat tropical."
                ),
                DoctorEntity(
                    id = "doc_5", name = "Dr. Emmanuel Jerome",
                    specialty = "Ophtalmologie", licenseNumber = "MSPP-10924",
                    location = "Port-au-Prince, Haiti",
                    avatarUrl = "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&q=80&w=200",
                    rating = 4.6, isAvailable = true,
                    hospital = "Clinique Ophtalmologique de Petion-Ville",
                    biography = "Traitement du glaucome, de la cataracte et correction de la vision."
                ),
                DoctorEntity(
                    id = "doc_6", name = "Dr. Reginald Saint-Jean",
                    specialty = "Orthopedie", licenseNumber = "MSPP-48192",
                    location = "Cap-Haitien, Haiti",
                    avatarUrl = "https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&q=80&w=200",
                    rating = 4.8, isAvailable = true,
                    hospital = "Hopital Sacre-Coeur de Milot",
                    biography = "Chirurgien orthopedique specialise dans la reconstruction articulaire."
                ),
                DoctorEntity(
                    id = "doc_7", name = "Dr. Wideline Augustin",
                    specialty = "Medecine Generale", licenseNumber = "MSPP-74312",
                    location = "Port-au-Prince, Haiti",
                    avatarUrl = "https://images.unsplash.com/photo-1527613426441-4da17471b66d?auto=format&fit=crop&q=80&w=200",
                    rating = 4.5, isAvailable = true,
                    hospital = "Centre de Sante de Carrefour",
                    biography = "Medecin de famille devouee. Consultations de routine et prevention."
                ),
                DoctorEntity(
                    id = "doc_8", name = "Dr. Marc-Antoine Joseph",
                    specialty = "Medecine Generale", licenseNumber = "MSPP-62045",
                    location = "Jacmel, Haiti",
                    avatarUrl = "https://images.unsplash.com/photo-1614608682850-e0d6ed316d47?auto=format&fit=crop&q=80&w=200",
                    rating = 4.7, isAvailable = true,
                    hospital = "Hopital Saint-Michel de Jacmel",
                    biography = "Consultations generales pour toute la famille."
                )
            )
            dao.insertDoctors(defaultDoctors)
        }
    }

    suspend fun insertDoctors(doctors: List<DoctorEntity>) = withContext(Dispatchers.IO) {
        dao.insertDoctors(doctors)
    }

    suspend fun getAvailableDoctorsBySpecialty(specialty: String): List<DoctorEntity> = withContext(Dispatchers.IO) {
        dao.getAvailableDoctorsBySpecialty(specialty)
    }

    suspend fun savePatientProfile(profile: PatientProfileEntity) = withContext(Dispatchers.IO) {
        dao.insertPatientProfile(profile)
    }

    suspend fun getPatientProfile(): PatientProfileEntity? = withContext(Dispatchers.IO) {
        dao.getPatientProfile()
    }

    suspend fun updateConsultation(consultation: ConsultationEntity) = withContext(Dispatchers.IO) {
        dao.updateConsultation(consultation)
    }

    suspend fun insertConsultation(consultation: ConsultationEntity) = withContext(Dispatchers.IO) {
        dao.insertConsultation(consultation)
    }

    suspend fun getConsultationById(id: String): ConsultationEntity? = withContext(Dispatchers.IO) {
        dao.getConsultationById(id)
    }

    suspend fun insertMessage(message: MessageEntity) = withContext(Dispatchers.IO) {
        dao.insertMessage(message)
    }

    suspend fun deleteMessagesForConsultation(consultationId: String) = withContext(Dispatchers.IO) {
        dao.deleteMessagesForConsultation(consultationId)
    }

    suspend fun deleteMessage(id: Int) = withContext(Dispatchers.IO) {
        dao.deleteMessage(id)
    }

    /** Update send status and (optionally) the server fileUrl / local file path. */
    suspend fun updateMessageStatus(id: Int, status: String?, fileUrl: String? = null, localFilePath: String? = null) =
        withContext(Dispatchers.IO) {
            dao.updateMessageStatus(id, status, fileUrl, localFilePath)
        }

    /** Update only the local file path (and optionally file size) — used after auto-downloading a received media. */
    suspend fun updateMessageLocalFile(id: Int, localFilePath: String?, fileSize: Long? = null) =
        withContext(Dispatchers.IO) {
            dao.updateMessageLocalFile(id, localFilePath, fileSize)
        }

    suspend fun getMessageById(id: Int): MessageEntity? = withContext(Dispatchers.IO) {
        dao.getMessageById(id)
    }

    fun getMessagesForConsultation(consultationId: String): Flow<List<MessageEntity>> {
        return dao.getMessagesForConsultation(consultationId)
    }

    suspend fun getMessagesForConsultationOnce(consultationId: String): List<MessageEntity> = withContext(Dispatchers.IO) {
        dao.getMessagesForConsultationOnce(consultationId)
    }

    suspend fun updateDoctorAvailability(doctorId: String, isAvailable: Boolean) = withContext(Dispatchers.IO) {
        val doctors = dao.getAllDoctors()
        val match = doctors.firstOrNull { it.id == doctorId }
        if (match != null) {
            dao.updateDoctor(match.copy(isAvailable = isAvailable))
        }
    }
}