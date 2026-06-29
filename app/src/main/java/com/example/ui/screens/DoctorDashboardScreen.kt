package com.example.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.data.db.ConsultationEntity
import com.example.data.db.DoctorEntity
import com.example.ui.SanteViewModel
import com.example.ui.components.*
import com.example.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DoctorDashboardScreen(
    viewModel: SanteViewModel,
    onNavigate: (String) -> Unit
) {
    val authState by viewModel.authState.collectAsStateWithLifecycle()
    val consultations by viewModel.allConsultations.collectAsStateWithLifecycle()

    // Sync from server every time dashboard appears
    LaunchedEffect(Unit) {
        viewModel.refreshConsultations()
    }

    val doctor = (authState as? com.example.ui.AuthState.DoctorAuthenticated)?.doctor
    var isOnline by remember { mutableStateOf(doctor?.isAvailable ?: true) }
    var historyExpanded by remember { mutableStateOf(false) }

    // Filter consultations assigned to this doctor
    val myConsultations = remember(consultations, doctor) {
        consultations.filter { it.doctorId == doctor?.id || it.doctorId == null }
    }

    val demandes = remember(myConsultations) {
        myConsultations.filter { it.status == "RECHERCHE_MEDECIN" }
    }
    val enCours = remember(myConsultations) {
        myConsultations.filter { it.status == "EN_COURS" }
    }
    val termines = remember(myConsultations) {
        myConsultations.filter { it.status == "TERMINE" }
    }

    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SanteBackground)
            .verticalScroll(scrollState)
            .padding(bottom = 80.dp)
    ) {
        // ── Green Doctor Header ──
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = androidx.compose.animation.core.tween(500)) +
                    slideInVertically(
                        initialOffsetY = { -40 },
                        animationSpec = androidx.compose.animation.core.tween(500)
                    )
        ) {
            DoctorHeaderSection(
                doctor = doctor,
                isOnline = isOnline,
                onToggleOnline = { newStatus ->
                    isOnline = newStatus
                    doctor?.let { viewModel.toggleDoctorAvailability(it.id, newStatus) }
                }
            )
        }

        Spacer(modifier = Modifier.height(20.dp))

        // ── Stats Row ──
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = androidx.compose.animation.core.tween(500, delayMillis = 100)) +
                    slideInVertically(
                        initialOffsetY = { 30 },
                        animationSpec = androidx.compose.animation.core.tween(500, delayMillis = 100)
                    )
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                StatCard(
                    modifier = Modifier.weight(1f),
                    title = "Demandes",
                    value = demandes.size.toString(),
                    icon = Icons.Default.Pending,
                    tint = SanteWarning
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    title = "En cours",
                    value = enCours.size.toString(),
                    icon = Icons.Default.VideoCall,
                    tint = Green500
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    title = "Terminées",
                    value = termines.size.toString(),
                    icon = Icons.Default.TaskAlt,
                    tint = TextSecondary
                )
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        // ── Demandes de Consultation ──
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = androidx.compose.animation.core.tween(500, delayMillis = 200)) +
                    slideInVertically(
                        initialOffsetY = { 30 },
                        animationSpec = androidx.compose.animation.core.tween(500, delayMillis = 200)
                    )
        ) {
            Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                Text(
                    text = "Demandes de Consultation",
                    style = MaterialTheme.typography.titleLarge.copy(
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                )

                Spacer(modifier = Modifier.height(12.dp))

                if (demandes.isEmpty()) {
                    SectionEmptyState(
                        icon = Icons.Default.Inbox,
                        message = "Aucune demande en attente"
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        demandes.forEach { consultation ->
                            DepthCard(modifier = Modifier.fillMaxWidth(), elevationLevel = 1) {
                                Column(modifier = Modifier.padding(16.dp)) {
                                    ConsultationCard(
                                        consultation = consultation,
                                        onClick = { /* No-op for demandes */ }
                                    )
                                    Spacer(modifier = Modifier.height(12.dp))
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                                    ) {
                                        AnimatedButton(
                                            onClick = {
                                                viewModel.doctorAcceptConsultation(consultation.id)
                                                onNavigate("chat")
                                            },
                                            text = "Accepter",
                                            modifier = Modifier.weight(1f)
                                        )
                                        OutlinedButton(
                                            onClick = {
                                                viewModel.doctorRejectConsultation(consultation.id)
                                            },
                                            modifier = Modifier.weight(1f),
                                            shape = RoundedCornerShape(12.dp),
                                            border = androidx.compose.foundation.BorderStroke(
                                                1.dp, SanteDanger
                                            )
                                        ) {
                                            Text(
                                                text = "Refuser",
                                                color = SanteDanger,
                                                fontWeight = FontWeight.SemiBold
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        // ── Consultations Actives ──
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = androidx.compose.animation.core.tween(500, delayMillis = 300)) +
                    slideInVertically(
                        initialOffsetY = { 30 },
                        animationSpec = androidx.compose.animation.core.tween(500, delayMillis = 300)
                    )
        ) {
            Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                Text(
                    text = "Consultations Actives",
                    style = MaterialTheme.typography.titleLarge.copy(
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                )

                Spacer(modifier = Modifier.height(12.dp))

                if (enCours.isEmpty()) {
                    SectionEmptyState(
                        icon = Icons.Default.ChatBubbleOutline,
                        message = "Aucune consultation active"
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        enCours.forEach { consultation ->
                            DepthCard(modifier = Modifier.fillMaxWidth(), elevationLevel = 1) {
                                Column(modifier = Modifier.padding(16.dp)) {
                                    ConsultationCard(
                                        consultation = consultation,
                                        onClick = {
                                            viewModel.setActiveConsultation(consultation.id)
                                            onNavigate("chat")
                                        }
                                    )
                                    Spacer(modifier = Modifier.height(12.dp))
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.End,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        // Phone call button
                                        IconButton(
                                            onClick = {
                                                viewModel.startCall(
                                                    consultationId = consultation.id,
                                                    peerName = consultation.patientName,
                                                    peerAvatar = null,
                                                    isVideo = false
                                                )
                                            },
                                            modifier = Modifier
                                                .size(44.dp)
                                                .background(Green50, CircleShape)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.Call,
                                                contentDescription = "Appel vocal",
                                                tint = Green700,
                                                modifier = Modifier.size(22.dp)
                                            )
                                        }
                                        Spacer(modifier = Modifier.width(8.dp))
                                        // Video call button
                                        IconButton(
                                            onClick = {
                                                viewModel.startCall(
                                                    consultationId = consultation.id,
                                                    peerName = consultation.patientName,
                                                    peerAvatar = null,
                                                    isVideo = true
                                                )
                                            },
                                            modifier = Modifier
                                                .size(44.dp)
                                                .background(Green50, CircleShape)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.Videocam,
                                                contentDescription = "Appel vidéo",
                                                tint = Green700,
                                                modifier = Modifier.size(22.dp)
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        // ── Historique (collapsible) ──
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = androidx.compose.animation.core.tween(500, delayMillis = 400)) +
                    slideInVertically(
                        initialOffsetY = { 30 },
                        animationSpec = androidx.compose.animation.core.tween(500, delayMillis = 400)
                    )
        ) {
            Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(SanteCard)
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Historique (${termines.size})",
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                    )
                    IconButton(onClick = { historyExpanded = !historyExpanded }) {
                        Icon(
                            imageVector = if (historyExpanded) Icons.Default.ExpandLess
                            else Icons.Default.ExpandMore,
                            contentDescription = if (historyExpanded) "Réduire" else "Développer",
                            tint = TextSecondary
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                AnimatedVisibility(visible = historyExpanded) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (termines.isEmpty()) {
                            SectionEmptyState(
                                icon = Icons.Default.History,
                                message = "Aucune consultation terminée"
                            )
                        } else {
                            termines.forEach { consultation ->
                                ConsultationCard(
                                    consultation = consultation,
                                    onClick = {
                                        viewModel.setActiveConsultation(consultation.id)
                                        onNavigate("consultation_detail")
                                    }
                                )
                            }
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
private fun DoctorHeaderSection(
    doctor: DoctorEntity?,
    isOnline: Boolean,
    onToggleOnline: (Boolean) -> Unit
) {
    Surface(
        color = PrimaryGreen,
        shadowElevation = 4.dp,
        shape = RoundedCornerShape(bottomStart = 28.dp, bottomEnd = 28.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 20.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column {
                        Text(
                            text = doctor?.name ?: "Médecin",
                            style = MaterialTheme.typography.headlineMedium.copy(
                                fontWeight = FontWeight.Bold,
                                color = Color.White
                            )
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = doctor?.specialty ?: "Spécialité",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color.White.copy(alpha = 0.85f)
                        )
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = if (isOnline) "En ligne" else "Hors ligne",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White.copy(alpha = 0.9f),
                        fontWeight = FontWeight.Medium
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Switch(
                        checked = isOnline,
                        onCheckedChange = onToggleOnline,
                        colors = SwitchDefaults.colors(
                            checkedTrackColor = Color.White.copy(alpha = 0.5f),
                            checkedThumbColor = Color.White,
                            uncheckedTrackColor = Color.White.copy(alpha = 0.2f)
                        )
                    )
                }
            }
        }
    }
}

@Composable
private fun SectionEmptyState(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    message: String
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(48.dp),
            tint = Green200
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = TextSecondary,
            textAlign = TextAlign.Center
        )
    }
}