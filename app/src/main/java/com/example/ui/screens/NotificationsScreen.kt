package com.example.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.db.ConsultationEntity
import com.example.ui.SanteViewModel
import com.example.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(
    viewModel: SanteViewModel,
    onBack: () -> Unit
) {
    val consultations by viewModel.allConsultations.collectAsStateWithLifecycle()
    val wsConnected by viewModel.wsConnected.collectAsStateWithLifecycle()

    val recentActivity = consultations
        .filter { it.status == "RECHERCHE_MEDECIN" || it.status == "EN_COURS" }
        .sortedByDescending { it.timestamp }
        .take(10)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SanteBackground)
    ) {
        // Green header
        Surface(
            color = PrimaryGreen,
            shadowElevation = 4.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour", tint = Color.White)
                }
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("Notifications", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text("Activité récente", color = Color.White.copy(alpha = 0.8f), fontSize = 13.sp)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .background(
                                if (wsConnected) Color.White else SanteWarning.copy(alpha = 0.7f),
                                CircleShape
                            )
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = if (wsConnected) "En ligne" else "Reconnexion...",
                        color = Color.White, fontSize = 12.sp
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        if (recentActivity.isEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(vertical = 80.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    modifier = Modifier
                        .size(80.dp)
                        .background(Green50, CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.Notifications,
                        contentDescription = null,
                        modifier = Modifier.size(40.dp),
                        tint = Green200
                    )
                }
                Spacer(modifier = Modifier.height(16.dp))
                Text("Aucune notification", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    "Vos nouvelles notifications apparaitront ici",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 40.dp)
                )
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                recentActivity.forEachIndexed { index, consultation ->
                    NotificationCard(consultation, index)
                }
            }
        }
    }
}

@Composable
private fun NotificationCard(consultation: ConsultationEntity, index: Int) {
    val statusInfo = when (consultation.status) {
        "RECHERCHE_MEDECIN" -> "En attente" to SanteWarning
        "EN_COURS" -> "En cours" to PrimaryGreen
        "TERMINE" -> "Terminée" to Green500
        "REFUSE" -> "Refusée" to SanteDanger
        else -> consultation.status to TextSecondary
    }

    AnimatedVisibility(
        visible = true,
        enter = fadeIn(animationSpec = tween(400, delayMillis = index * 80)) +
                slideInVertically(initialOffsetY = { 20 }, animationSpec = tween(400, delayMillis = index * 80))
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            color = Color.White,
            shadowElevation = 2.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .background(statusInfo.second.copy(alpha = 0.12f), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = statusInfo.first.take(1),
                        color = statusInfo.second,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp
                    )
                }

                Spacer(modifier = Modifier.width(14.dp))

                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = consultation.patientName,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = TextPrimary
                    )
                    Text(
                        text = consultation.description.take(60),
                        fontSize = 13.sp,
                        color = TextSecondary,
                        maxLines = 1
                    )
                }

                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = statusInfo.second.copy(alpha = 0.12f)
                ) {
                    Text(
                        text = statusInfo.first,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = statusInfo.second
                    )
                }
            }
        }
    }
}