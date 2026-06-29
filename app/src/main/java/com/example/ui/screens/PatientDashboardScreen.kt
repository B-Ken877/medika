package com.example.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.*
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.data.db.ConsultationEntity
import com.example.ui.SanteViewModel
import com.example.ui.components.*
import com.example.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientDashboardScreen(
    viewModel: SanteViewModel,
    onNavigate: (String) -> Unit
) {
    val profile by viewModel.patientProfile.collectAsStateWithLifecycle()
    val consultations by viewModel.allConsultations.collectAsStateWithLifecycle()
    val activeConsultationId by viewModel.activeConsultationId.collectAsStateWithLifecycle()
    val wsConnected by viewModel.wsConnected.collectAsStateWithLifecycle()

    // Sync from server every time dashboard appears
    LaunchedEffect(Unit) {
        viewModel.refreshConsultations()
    }

    val scrollState = rememberScrollState()
    val listScrollState = rememberScrollState()

    val enCoursCount = consultations.count { it.status == "EN_COURS" }
    val rechercheCount = consultations.count { it.status == "RECHERCHE_MEDECIN" }
    val termineCount = consultations.count { it.status == "TERMINE" }
    val hasUnread = consultations.any { it.status == "RECHERCHE_MEDECIN" || it.status == "EN_COURS" }

    val recentConsultations = consultations
        .filter { it.status != "REFUSE" }
        .sortedByDescending { it.timestamp }
        .take(10)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SanteBackground)
            .verticalScroll(scrollState)
            .padding(bottom = 100.dp)
    ) {
        // ── Green top greeting bar ──
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(500)) +
                    slideInVertically(initialOffsetY = { -40 }, animationSpec = tween(500))
        ) {
            TopAppBarSection(
                name = profile?.name?.split(" ")?.firstOrNull() ?: "Patient",
                hasUnread = hasUnread,
                wsConnected = wsConnected,
                onNotificationClick = { onNavigate("notifications") }
            )
        }

        Spacer(modifier = Modifier.height(20.dp))

        // ── Quick Actions Row ──
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(500, delayMillis = 100)) +
                    slideInVertically(initialOffsetY = { 30 }, animationSpec = tween(500, delayMillis = 100))
        ) {
            QuickActionsRow(onNavigate = onNavigate, listScrollState = listScrollState)
        }

        Spacer(modifier = Modifier.height(24.dp))

        // ── Stats Row ──
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(500, delayMillis = 200)) +
                    slideInVertically(initialOffsetY = { 30 }, animationSpec = tween(500, delayMillis = 200))
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                StatCard(
                    modifier = Modifier.weight(1f),
                    title = "Consultations",
                    value = enCoursCount.toString(),
                    icon = Icons.AutoMirrored.Filled.Chat,
                    tint = Green500
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    title = "En attente",
                    value = rechercheCount.toString(),
                    icon = Icons.Default.Schedule,
                    tint = SanteWarning
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    title = "Terminées",
                    value = termineCount.toString(),
                    icon = Icons.Default.CheckCircle,
                    tint = Green500
                )
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        // ── Consultations Récentes ──
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(500, delayMillis = 300)) +
                    slideInVertically(initialOffsetY = { 30 }, animationSpec = tween(500, delayMillis = 300))
        ) {
            Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Consultations Récentes",
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                    )
                    TextButton(onClick = {
                        // Show all consultations (could filter)
                    }) {
                        Text("Voir tout", color = PrimaryGreen, fontWeight = FontWeight.SemiBold)
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                if (recentConsultations.isEmpty()) {
                    EmptyConsultationsState(onNavigate = onNavigate)
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        recentConsultations.forEach { consultation ->
                            ConsultationCard(
                                consultation = consultation,
                                onClick = {
                                    viewModel.setActiveConsultation(consultation.id)
                                    onNavigate("chat")
                                }
                            )
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        // ── Conseils Santé ──
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(500, delayMillis = 400)) +
                    slideInVertically(initialOffsetY = { 30 }, animationSpec = tween(500, delayMillis = 400))
        ) {
            Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                Text(
                    text = "Conseils Santé",
                    style = MaterialTheme.typography.titleLarge.copy(
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                )

                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    healthTips.forEach { tip ->
                        HealthTipCard(tip = tip)
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
private fun TopAppBarSection(
    name: String,
    hasUnread: Boolean,
    wsConnected: Boolean,
    onNotificationClick: () -> Unit
) {
    Surface(
        color = PrimaryGreen,
        shadowElevation = 4.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .background(Color.White.copy(alpha = 0.2f), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = name.first().uppercase(),
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp
                    )
                }
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text(
                        text = "Bonjour,",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.White.copy(alpha = 0.85f)
                    )
                    Text(
                        text = name,
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.Bold,
                            color = Color.White
                        )
                    )
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                // Connection indicator
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .background(
                            if (wsConnected) Color.White else SanteWarning.copy(alpha = 0.8f),
                            CircleShape
                        )
                )
                Spacer(modifier = Modifier.width(4.dp))

                Box {
                    IconButton(onClick = onNotificationClick) {
                        Icon(
                            Icons.Default.Notifications,
                            contentDescription = "Notifications",
                            tint = Color.White,
                            modifier = Modifier.size(26.dp)
                        )
                    }
                    if (hasUnread) {
                        Box(
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .padding(2.dp)
                                .size(12.dp)
                                .background(SanteWarning, CircleShape)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun QuickActionsRow(
    onNavigate: (String) -> Unit,
    listScrollState: androidx.compose.foundation.ScrollState
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.SpaceEvenly
    ) {
        QuickActionButton(
            label = "Nouvelle\nConsultation",
            icon = Icons.Default.Add,
            onClick = { onNavigate("intake") }
        )
        QuickActionButton(
            label = "Mes\nConsultations",
            icon = Icons.AutoMirrored.Filled.Chat,
            onClick = { /* already visible below */ }
        )
        QuickActionButton(
            label = "Mon\nProfil",
            icon = Icons.Default.Person,
            onClick = { onNavigate("profile") }
        )
    }
}

@Composable
private fun QuickActionButton(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.width(100.dp)
    ) {
        IconButton(
            onClick = onClick,
            modifier = Modifier
                .size(64.dp)
                .background(PrimaryGreen, CircleShape)
                .shadow(4.dp, CircleShape)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = Color.White,
                modifier = Modifier.size(30.dp)
            )
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = TextPrimary,
            textAlign = TextAlign.Center,
            fontWeight = FontWeight.Medium,
            lineHeight = 16.sp
        )
    }
}

@Composable
private fun EmptyConsultationsState(onNavigate: (String) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .background(Green50, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Default.ContentCopy,
                contentDescription = null,
                modifier = Modifier.size(36.dp),
                tint = Green200
            )
        }
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "Aucune consultation",
            style = MaterialTheme.typography.bodyLarge,
            color = TextSecondary
        )
        Spacer(modifier = Modifier.height(16.dp))
        AnimatedButton(
            onClick = { onNavigate("intake") },
            text = "Commencer une consultation"
        )
    }
}

private data class HealthTip(
    val title: String,
    val description: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

private val healthTips = listOf(
    HealthTip("Hydratez-vous", "Buvez au moins 8 verres d'eau par jour", Icons.Default.WaterDrop),
    HealthTip("Sommeil réparateur", "Visez 7-8 heures de sommeil chaque nuit", Icons.Default.Bedtime),
    HealthTip("Activité physique", "30 minutes de marche quotidienne", Icons.Default.DirectionsRun)
)

@Composable
private fun HealthTipCard(tip: HealthTip) {
    DepthCard(
        modifier = Modifier.width(200.dp),
        elevationLevel = 1
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.Top
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .background(Green50, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = tip.icon,
                    contentDescription = null,
                    tint = PrimaryGreen,
                    modifier = Modifier.size(20.dp)
                )
            }
            Spacer(modifier = Modifier.width(12.dp))
            Column {
                Text(
                    text = tip.title,
                    style = MaterialTheme.typography.titleSmall.copy(
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = tip.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary,
                    lineHeight = 16.sp
                )
            }
        }
    }
}