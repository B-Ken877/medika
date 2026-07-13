package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MedicalInformation
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.data.api.*
import com.example.ui.SanteViewModel
import com.example.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MedicalHistoryScreen(
    viewModel: SanteViewModel,
    onBack: () -> Unit = {},
) {
    val medicalHistory by viewModel.medicalHistory.collectAsStateWithLifecycle()
    val isLoading by viewModel.medicalHistoryLoading.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) {
        viewModel.loadMedicalHistory()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = PrimaryGreen,
                    titleContentColor = Color.White,
                ),
                title = {
                    Text(
                        "Mon Dossier Medical",
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Retour",
                            tint = Color.White
                        )
                    }
                }
            )
        }
    ) { padding ->
        if (isLoading) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = PrimaryGreen)
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Allergies Section
                MedicalSection(
                    title = "Allergies",
                    icon = Icons.Default.Warning,
                    color = SanteDanger,
                    items = medicalHistory?.allergies?.map { it.name } ?: emptyList(),
                    emptyText = "Aucune allergie enregistree"
                )

                // Chronic Conditions
                MedicalSection(
                    title = "Maladies Chroniques",
                    icon = Icons.Default.MedicalInformation,
                    color = SanteWarning,
                    items = medicalHistory?.chronic_conditions?.map { it.name } ?: emptyList(),
                    emptyText = "Aucune condition chronique"
                )

                // Current Medications
                MedicalSection(
                    title = "Medicaments Actuels",
                    icon = Icons.Default.Edit,
                    color = SanteInfo,
                    items = medicalHistory?.current_medications?.map { m ->
                        buildString {
                            append(m.name)
                            if (m.dosage.isNotBlank()) append(" - ${m.dosage}")
                        }
                    } ?: emptyList(),
                    emptyText = "Aucun medicament en cours"
                )

                // Vaccinations
                MedicalSection(
                    title = "Vaccinations",
                    icon = Icons.Default.MedicalInformation,
                    color = PrimaryGreen,
                    items = medicalHistory?.vaccinations?.map { v ->
                        buildString {
                            append(v.name)
                            if (v.date != null) append(" (${v.date})"
                        }
                    } ?: emptyList(),
                    emptyText = "Aucun vaccin enregistre"
                )

                // Consultation Timeline
                Text(
                    text = "Historique des Consultations",
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                )

                val timeline = medicalHistory?.consultation_timeline?.reversed() ?: emptyList()
                if (timeline.isEmpty()) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Neutral100),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(
                            "Aucune consultation anterieure",
                            modifier = Modifier.padding(16.dp),
                            color = TextTertiary,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                } else {
                    timeline.forEach { entry ->
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = Color.White),
                            shape = RoundedCornerShape(12.dp),
                            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
                        ) {
                            Column(modifier = Modifier.padding(14.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        entry.date ?: "",
                                        fontSize = 12.sp,
                                        color = TextTertiary
                                    )
                                    Text(
                                        entry.doctor_name,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = PrimaryGreen
                                    )
                                }
                                if (entry.diagnosis.isNotBlank()) {
                                    Spacer(modifier = Modifier.height(6.dp))
                                    Text(
                                        "Diagnostic: ${entry.diagnosis}",
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = TextPrimary
                                    )
                                }
                                if (entry.summary.isNotBlank()) {
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        entry.summary,
                                        fontSize = 13.sp,
                                        color = TextSecondary,
                                        maxLines = 3
                                    )
                                }
                                if (entry.prescriptions.isNotEmpty()) {
                                    Spacer(modifier = Modifier.height(6.dp))
                                    Text(
                                        "Medicaments: ${entry.prescriptions.joinToString(", ")}",
                                        fontSize = 12.sp,
                                        color = SanteInfo
                                    )
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(32.dp))
            }
        }
    }
}

@Composable
private fun MedicalSection(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    color: Color,
    items: List<String>,
    emptyText: String
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(20.dp))
                Text(
                    title,
                    style = MaterialTheme.typography.titleSmall.copy(
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            if (items.isEmpty()) {
                Text(
                    emptyText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextTertiary
                )
            } else {
                items.forEach { item ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(vertical = 3.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .background(color, CircleShape)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            item,
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextPrimary
                        )
                    }
                }
            }
        }
    }
}
