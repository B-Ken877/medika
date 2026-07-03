package com.example.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Pending
import androidx.compose.material.icons.filled.PeopleAlt
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.R
import com.example.data.db.ConsultationEntity
import com.example.ui.SanteViewModel
import com.example.ui.components.AnimatedButton
import com.example.ui.components.DepthCard
import com.example.ui.components.StatCard
import com.example.ui.theme.*
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

// ═══════════════════════════════════════════════════════════════════════════════
// DoctorDashboardScreen — Professional medical provider dashboard
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
fun DoctorDashboardScreen(
    viewModel: SanteViewModel,
    onNavigate: (String) -> Unit
) {
    val authState by viewModel.authState.collectAsStateWithLifecycle()
    val allConsultations by viewModel.allConsultations.collectAsStateWithLifecycle()
    val isSyncing by viewModel.isSyncing.collectAsStateWithLifecycle()

    // Sync from server every time dashboard appears
    LaunchedEffect(Unit) {
        viewModel.refreshConsultations()
    }

    val doctor = (authState as? com.example.ui.AuthState.DoctorAuthenticated)?.doctor
    var isOnline by remember { mutableStateOf(doctor?.isAvailable ?: true) }
    var historyExpanded by remember { mutableStateOf(false) }

    // ── Filter consultations assigned to this doctor ──
    val myConsultations = remember(allConsultations, doctor) {
        allConsultations.filter { it.doctorId == doctor?.id || it.doctorId == null }
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
    val lastName = remember(doctor) {
        doctor?.name?.split(" ")?.lastOrNull()?.uppercase() ?: ""
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SanteBackground)
            .verticalScroll(scrollState)
            .padding(bottom = 80.dp)
    ) {
        // ══════════════════════════════════════════════════════════════
        // TOP HEADER — Green gradient, rounded bottom, logo + name
        // ══════════════════════════════════════════════════════════════
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(500)) +
                    slideInVertically(
                        initialOffsetY = { -40 },
                        animationSpec = tween(500)
                    )
        ) {
            DoctorDashboardHeader(
                lastName = lastName,
                isOnline = isOnline,
                onToggleOnline = { newStatus ->
                    isOnline = newStatus
                    doctor?.let { viewModel.toggleDoctorAvailability(it.id, newStatus) }
                },
                onNotificationClick = { onNavigate("notifications") }
            )
        }

        Spacer(modifier = Modifier.height(20.dp))

        // ══════════════════════════════════════════════════════════════
        // STATUS SECTION — Large card with online/offline toggle
        // ══════════════════════════════════════════════════════════════
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(500, delayMillis = 80)) +
                    slideInVertically(
                        initialOffsetY = { 30 },
                        animationSpec = tween(500, delayMillis = 80)
                    )
        ) {
            DoctorStatusCard(
                isOnline = isOnline,
                queueCount = demandes.size,
                onToggleOnline = { newStatus ->
                    isOnline = newStatus
                    doctor?.let { viewModel.toggleDoctorAvailability(it.id, newStatus) }
                }
            )
        }

        Spacer(modifier = Modifier.height(20.dp))

        // ══════════════════════════════════════════════════════════════
        // STATS ROW — Quick glance at consultation counts
        // ══════════════════════════════════════════════════════════════
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(500, delayMillis = 160)) +
                    slideInVertically(
                        initialOffsetY = { 30 },
                        animationSpec = tween(500, delayMillis = 160)
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
                    title = "File d'attente",
                    value = demandes.size.toString(),
                    icon = Icons.Default.Pending,
                    tint = SanteWarning
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    title = "En cours",
                    value = enCours.size.toString(),
                    icon = Icons.Default.PeopleAlt,
                    tint = Green100
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    title = "Terminées",
                    value = termines.size.toString(),
                    icon = Icons.Default.TaskAlt,
                    tint = Neutral100
                )
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        // ══════════════════════════════════════════════════════════════
        // ACTIVE CONSULTATIONS — Demandes (RECHERCHE_MEDECIN)
        // ══════════════════════════════════════════════════════════════
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(500, delayMillis = 240)) +
                    slideInVertically(
                        initialOffsetY = { 30 },
                        animationSpec = tween(500, delayMillis = 240)
                    )
        ) {
            Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                SectionHeader(
                    title = "Consultations Actives",
                    count = demandes.size + enCours.size
                )

                Spacer(modifier = Modifier.height(12.dp))

                // ── Pending requests (RECHERCHE_MEDECIN) ──
                if (demandes.isNotEmpty()) {
                    demandes.forEach { consultation ->
                        PendingConsultationCard(
                            consultation = consultation,
                            onAccept = {
                                viewModel.doctorAcceptConsultation(consultation.id)
                                onNavigate("chat")
                            },
                            onReject = {
                                viewModel.doctorRejectConsultation(consultation.id)
                            }
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                    }
                }

                // ── In-progress (EN_COURS) ──
                if (enCours.isNotEmpty()) {
                    enCours.forEach { consultation ->
                        ActiveConsultationCard(
                            consultation = consultation,
                            onOpen = {
                                viewModel.setActiveConsultation(consultation.id)
                                onNavigate("chat")
                            },
                            onVoiceCall = {
                                viewModel.startCall(
                                    consultationId = consultation.id,
                                    peerName = consultation.patientName,
                                    peerAvatar = null,
                                    isVideo = false
                                )
                            },
                            onVideoCall = {
                                viewModel.startCall(
                                    consultationId = consultation.id,
                                    peerName = consultation.patientName,
                                    peerAvatar = null,
                                    isVideo = true
                                )
                            }
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                    }
                }

                // ── Empty state for active consultations ──
                if (demandes.isEmpty() && enCours.isEmpty()) {
                    DoctorEmptyState(
                        icon = Icons.Default.ChatBubbleOutline,
                        title = if (isOnline) "Aucune consultation active"
                                else "Vous êtes hors ligne",
                        message = if (isOnline) "Les nouvelles demandes apparaîtront ici automatiquement."
                                else "Mettez-vous en ligne pour recevoir des demandes de consultation."
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        // ══════════════════════════════════════════════════════════════
        // COMPLETED SECTION — Dernières Consultations (collapsible)
        // ══════════════════════════════════════════════════════════════
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(500, delayMillis = 320)) +
                    slideInVertically(
                        initialOffsetY = { 30 },
                        animationSpec = tween(500, delayMillis = 320)
                    )
        ) {
            Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                // Expandable header
                DepthCard(
                    modifier = Modifier.fillMaxWidth(),
                    elevationLevel = 0
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { historyExpanded = !historyExpanded }
                            .padding(horizontal = 20.dp, vertical = 16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = "Dernières Consultations",
                                style = MaterialTheme.typography.titleMedium.copy(
                                    fontWeight = FontWeight.Bold,
                                    color = TextPrimary
                                )
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                            Surface(
                                shape = RoundedCornerShape(20.dp),
                                color = Neutral100
                            ) {
                                Text(
                                    text = termines.size.toString(),
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 2.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = TextSecondary,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        }
                        Icon(
                            imageVector = if (historyExpanded) Icons.Default.History
                            else Icons.Default.History,
                            contentDescription = if (historyExpanded) "Réduire" else "Voir l'historique",
                            tint = TextSecondary,
                            modifier = Modifier.size(22.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                AnimatedVisibility(
                    visible = historyExpanded,
                    enter = fadeIn() + slideInVertically(),
                    exit = fadeOut() + slideOutVertically()
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (termines.isEmpty()) {
                            DoctorEmptyState(
                                icon = Icons.Default.Inbox,
                                title = "Aucune consultation terminée",
                                message = "Vos consultations terminées apparaîtront ici."
                            )
                        } else {
                            termines.take(10).forEach { consultation ->
                                CompletedConsultationCard(
                                    consultation = consultation,
                                    onClick = {
                                        viewModel.setActiveConsultation(consultation.id)
                                        onNavigate("consultation_detail")
                                    }
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                            }
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DoctorDashboardHeader — Green gradient header with logo, name, controls
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
private fun DoctorDashboardHeader(
    lastName: String,
    isOnline: Boolean,
    onToggleOnline: (Boolean) -> Unit,
    onNotificationClick: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(PrimaryGreen, Green700)
                ),
                shape = RoundedCornerShape(bottomStart = 24.dp, bottomEnd = 24.dp)
            )
            .padding(top = 48.dp) // status bar space
            .padding(horizontal = 20.dp, vertical = 20.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // ── Left: Logo + Doctor name ──
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    painter = painterResource(R.drawable.medika_logo_sm),
                    contentDescription = "Medika",
                    modifier = Modifier.size(32.dp),
                    tint = Color.Unspecified
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text(
                        text = "Dr. $lastName",
                        style = MaterialTheme.typography.headlineSmall.copy(
                            fontWeight = FontWeight.Bold,
                            color = Color.White
                        ),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = "Tableau de bord",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.White.copy(alpha = 0.8f)
                    )
                }
            }

            // ── Right: Notification bell + Online toggle ──
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Notification bell
                IconButton(
                    onClick = onNotificationClick,
                    modifier = Modifier.size(44.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.Notifications,
                            contentDescription = "Notifications",
                            tint = Color.White,
                            modifier = Modifier.size(24.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.width(4.dp))

                // Online/Offline text label
                Text(
                    text = if (isOnline) "En ligne" else "Hors ligne",
                    style = MaterialTheme.typography.labelMedium,
                    color = Color.White.copy(alpha = 0.9f),
                    fontWeight = FontWeight.Medium
                )

                Spacer(modifier = Modifier.width(6.dp))

                Switch(
                    checked = isOnline,
                    onCheckedChange = onToggleOnline,
                    colors = SwitchDefaults.colors(
                        checkedTrackColor = Color.White.copy(alpha = 0.45f),
                        checkedThumbColor = Color.White,
                        uncheckedTrackColor = Color.White.copy(alpha = 0.2f),
                        uncheckedThumbColor = Color.White.copy(alpha = 0.6f)
                    )
                )
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DoctorStatusCard — Prominent status display with toggle and queue info
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
private fun DoctorStatusCard(
    isOnline: Boolean,
    queueCount: Int,
    onToggleOnline: (Boolean) -> Unit
) {
    val statusColor by animateColorAsState(
        targetValue = if (isOnline) SanteSuccess else Neutral400,
        animationSpec = tween(400),
        label = "status_color"
    )
    val statusBgColor by animateColorAsState(
        targetValue = if (isOnline) SanteSuccessBg else Neutral100,
        animationSpec = tween(400),
        label = "status_bg"
    )

    val pulseTransition = rememberInfiniteTransition(label = "pulse")
    val pulseAlpha by pulseTransition.animateFloat(
        initialValue = 1f,
        targetValue = 0.4f,
        animationSpec = infiniteRepeatable(
            animation = tween(1200),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse_alpha"
    )

    DepthCard(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        elevationLevel = 2
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // ── Status indicator + label ──
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // Pulsing dot
                    Box(
                        modifier = Modifier
                            .size(14.dp)
                            .background(statusColor, CircleShape)
                            .graphicsLayer { alpha = if (isOnline) pulseAlpha else 0.6f }
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Column {
                        Text(
                            text = if (isOnline) "En ligne" else "Hors ligne",
                            style = MaterialTheme.typography.titleLarge.copy(
                                fontWeight = FontWeight.Bold,
                                color = TextPrimary
                            )
                        )
                        Text(
                            text = if (isOnline) "Vous recevez des consultations"
                                   else "Aucune consultation ne vous sera assignée",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondary
                        )
                    }
                }

                // ── Toggle switch ──
                Switch(
                    checked = isOnline,
                    onCheckedChange = onToggleOnline,
                    colors = SwitchDefaults.colors(
                        checkedTrackColor = SanteSuccess,
                        checkedThumbColor = Color.White,
                        uncheckedTrackColor = Neutral300,
                        uncheckedThumbColor = Neutral500
                    )
                )
            }

            // ── Queue count badge (visible when online) ──
            AnimatedVisibility(
                visible = isOnline,
                enter = fadeIn(tween(300)) + slideInVertically(tween(300)),
                exit = fadeOut(tween(200))
            ) {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp),
                    shape = RoundedCornerShape(12.dp),
                    color = statusBgColor
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.PeopleAlt,
                            contentDescription = "File d'attente",
                            tint = statusColor,
                            modifier = Modifier.size(22.dp)
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Text(
                            text = "Patients en attente :",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary
                        )
                        Spacer(modifier = Modifier.weight(1f))
                        Surface(
                            shape = RoundedCornerShape(20.dp),
                            color = statusColor.copy(alpha = 0.15f)
                        ) {
                            Text(
                                text = "$queueCount",
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                                style = MaterialTheme.typography.titleMedium.copy(
                                    fontWeight = FontWeight.Bold
                                ),
                                color = statusColor
                            )
                        }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SectionHeader — Reusable section title with optional count badge
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
private fun SectionHeader(
    title: String,
    count: Int = 0,
    showCount: Boolean = true
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleLarge.copy(
                fontWeight = FontWeight.Bold,
                color = TextPrimary
            )
        )
        if (showCount && count > 0) {
            Spacer(modifier = Modifier.width(10.dp))
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = PrimaryGreen.copy(alpha = 0.1f)
            ) {
                Text(
                    text = "$count",
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 2.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = PrimaryGreen,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PendingConsultationCard — Card for RECHERCHE_MEDECIN consultations
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
private fun PendingConsultationCard(
    consultation: ConsultationEntity,
    onAccept: () -> Unit,
    onReject: () -> Unit
) {
    val waitingTime = remember(consultation.timestamp) {
        formatWaitingTime(consultation.timestamp)
    }

    DepthCard(
        modifier = Modifier.fillMaxWidth(),
        elevationLevel = 1
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // ── Top row: patient info + urgency badge ──
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top
            ) {
                // Patient avatar circle
                Surface(
                    modifier = Modifier.size(44.dp),
                    shape = CircleShape,
                    color = SanteWarningBg
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = consultation.patientName
                                .split(" ")
                                .filter { it.isNotBlank() }
                                .take(2)
                                .joinToString("") { it.first().uppercase() },
                            color = SanteWarning,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                Spacer(modifier = Modifier.width(14.dp))

                Column(modifier = Modifier.weight(1f)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = consultation.patientName,
                            style = MaterialTheme.typography.titleSmall.copy(
                                fontWeight = FontWeight.Bold,
                                color = TextPrimary
                            ),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f)
                        )

                        // Waiting time chip
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = SanteWarningBg
                        ) {
                            Text(
                                text = waitingTime,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                style = MaterialTheme.typography.labelSmall,
                                color = SanteWarning,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(4.dp))

                    // Symptom / specialty preview
                    if (consultation.description.isNotBlank()) {
                        Text(
                            text = consultation.description,
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            lineHeight = 18.sp
                        )
                    }

                    if (consultation.specialtyNeeded.isNotBlank()) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = Green50
                        ) {
                            Text(
                                text = consultation.specialtyNeeded,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                style = MaterialTheme.typography.labelSmall,
                                color = Green700,
                                fontWeight = FontWeight.Medium
                            )
                        }
                    }

                    // Patient age
                    if (consultation.patientAge > 0) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "${consultation.patientAge} ans",
                            style = MaterialTheme.typography.labelSmall,
                            color = TextTertiary
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            // ── Action buttons: Accepter / Refuser ──
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                AnimatedButton(
                    onClick = onAccept,
                    text = "Accepter",
                    modifier = Modifier.weight(1f)
                )
                OutlinedButton(
                    onClick = onReject,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(14.dp),
                    border = BorderStroke(1.dp, SanteDanger)
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

// ═══════════════════════════════════════════════════════════════════════════════
// ActiveConsultationCard — Card for EN_COURS consultations
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
private fun ActiveConsultationCard(
    consultation: ConsultationEntity,
    onOpen: () -> Unit,
    onVoiceCall: () -> Unit,
    onVideoCall: () -> Unit
) {
    DepthCard(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen),
        elevationLevel = 1
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top
            ) {
                // Patient avatar with green accent
                Surface(
                    modifier = Modifier.size(44.dp),
                    shape = CircleShape,
                    color = SanteSuccessBg
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = consultation.patientName
                                .split(" ")
                                .filter { it.isNotBlank() }
                                .take(2)
                                .joinToString("") { it.first().uppercase() },
                            color = SanteSuccess,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                Spacer(modifier = Modifier.width(14.dp))

                Column(modifier = Modifier.weight(1f)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = consultation.patientName,
                            style = MaterialTheme.typography.titleSmall.copy(
                                fontWeight = FontWeight.Bold,
                                color = TextPrimary
                            ),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f)
                        )

                        // "En cours" badge
                        Surface(
                            shape = RoundedCornerShape(20.dp),
                            color = SanteSuccess.copy(alpha = 0.1f)
                        ) {
                            Text(
                                text = "En cours",
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                style = MaterialTheme.typography.labelSmall,
                                color = SanteSuccess,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(4.dp))

                    // Symptom preview
                    if (consultation.description.isNotBlank()) {
                        Text(
                            text = consultation.description,
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            lineHeight = 18.sp
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            // ── Bottom row: Voir button + call actions ──
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // "Voir" button
                Surface(
                    onClick = onOpen,
                    shape = RoundedCornerShape(12.dp),
                    color = PrimaryGreen,
                    shadowElevation = 1.dp
                ) {
                    Text(
                        text = "Voir",
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 10.dp),
                        style = MaterialTheme.typography.labelLarge,
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold
                    )
                }

                // Call action buttons
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    // Voice call
                    Surface(
                        onClick = onVoiceCall,
                        shape = CircleShape,
                        color = Green50
                    ) {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier.size(42.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Call,
                                contentDescription = "Appel vocal",
                                tint = Green700,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }

                    // Video call
                    Surface(
                        onClick = onVideoCall,
                        shape = CircleShape,
                        color = Green50
                    ) {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier.size(42.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Videocam,
                                contentDescription = "Appel vidéo",
                                tint = Green700,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CompletedConsultationCard — Simpler card for TERMINE consultations
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
private fun CompletedConsultationCard(
    consultation: ConsultationEntity,
    onClick: () -> Unit
) {
    val formattedDate = remember(consultation.timestamp) {
        try {
            val sdf = SimpleDateFormat("dd MMM yyyy, HH:mm", Locale.FRENCH)
            sdf.format(Date(consultation.timestamp))
        } catch (_: Exception) {
            ""
        }
    }

    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = Color.White,
        shadowElevation = 0.5.dp,
        border = BorderStroke(0.5.dp, Neutral200)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, top = 14.dp, end = 14.dp, bottom = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Small completed avatar
            Surface(
                modifier = Modifier.size(36.dp),
                shape = CircleShape,
                color = Neutral100
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = consultation.patientName
                            .split(" ")
                            .filter { it.isNotBlank() }
                            .take(2)
                            .joinToString("") { it.first().uppercase() },
                        color = Neutral500,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            Spacer(modifier = Modifier.width(12.dp))

            // Info column
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = consultation.patientName,
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontWeight = FontWeight.SemiBold,
                        color = TextPrimary
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(modifier = Modifier.height(2.dp))

                Row {
                    if (consultation.specialtyNeeded.isNotBlank()) {
                        Text(
                            text = consultation.specialtyNeeded,
                            style = MaterialTheme.typography.labelSmall,
                            color = TextSecondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            }

            // Date
            Text(
                text = formattedDate,
                style = MaterialTheme.typography.labelSmall,
                color = TextTertiary,
                maxLines = 1
            )
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DoctorEmptyState — Friendly empty state for dashboard sections
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
private fun DoctorEmptyState(
    icon: ImageVector,
    title: String,
    message: String
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Surface(
            modifier = Modifier.size(64.dp),
            shape = CircleShape,
            color = Green50
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(30.dp),
                    tint = Green300
                )
            }
        }

        Spacer(modifier = Modifier.height(14.dp))

        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall.copy(
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary
            ),
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(6.dp))

        Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = TextSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp),
            lineHeight = 18.sp
        )
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility: Format waiting time as human-readable string
// ═══════════════════════════════════════════════════════════════════════════════

private fun formatWaitingTime(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val elapsed = now - timestamp
    val minutes = TimeUnit.MILLISECONDS.toMinutes(elapsed)

    return when {
        minutes < 1 -> "À l'instant"
        minutes < 60 -> "${minutes}min"
        minutes < 1440 -> {
            val hours = minutes / 60
            val rem = minutes % 60
            if (rem == 0L) "${hours}h" else "${hours}h${rem}min"
        }
        else -> {
            val days = minutes / 1440
            "${days}j"
        }
    }
}
