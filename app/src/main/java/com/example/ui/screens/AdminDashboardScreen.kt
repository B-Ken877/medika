package com.example.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
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
fun AdminDashboardScreen(
    viewModel: SanteViewModel,
    onNavigate: (String) -> Unit
) {
    val doctors by viewModel.allDoctors.collectAsStateWithLifecycle()
    val consultations by viewModel.allConsultations.collectAsStateWithLifecycle()
    var selectedFilter by remember { mutableStateOf(0) }
    var showCreateDoctorDialog by remember { mutableStateOf(false) }

    val scrollState = rememberScrollState()

    // Compute stats
    val totalDoctors = doctors.size
    val totalConsultations = consultations.size
    val acceptedCount = consultations.count { it.status == "EN_COURS" || it.status == "TERMINE" }
    val acceptanceRate = if (totalConsultations > 0) {
        ((acceptedCount.toFloat() / totalConsultations) * 100).toInt()
    } else 0

    // Filter consultations based on selected tab
    val filteredConsultations = remember(consultations, selectedFilter) {
        when (selectedFilter) {
            0 -> consultations.sortedByDescending { it.timestamp }
            1 -> consultations.filter { it.status == "RECHERCHE_MEDECIN" }
                .sortedByDescending { it.timestamp }
            2 -> consultations.filter { it.status == "EN_COURS" }
                .sortedByDescending { it.timestamp }
            3 -> consultations.filter { it.status == "TERMINE" }
                .sortedByDescending { it.timestamp }
            else -> consultations.sortedByDescending { it.timestamp }
        }
    }

    val filterTabs = listOf("Toutes", "En attente", "En cours", "Terminées")

    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(SanteBackground)
                .verticalScroll(scrollState)
                .padding(bottom = 80.dp)
        ) {
            // ── Admin Header ──
            AnimatedVisibility(
                visible = true,
                enter = fadeIn(animationSpec = androidx.compose.animation.core.tween(500)) +
                        slideInVertically(
                            initialOffsetY = { -40 },
                            animationSpec = androidx.compose.animation.core.tween(500)
                        )
            ) {
                Surface(
                    color = SanteCard,
                    shadowElevation = 2.dp,
                    shape = RoundedCornerShape(bottomStart = 24.dp, bottomEnd = 24.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 20.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Shield,
                            contentDescription = null,
                            modifier = Modifier.size(32.dp),
                            tint = PrimaryGreen
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = "Panneau d'Administration",
                                style = MaterialTheme.typography.headlineMedium.copy(
                                    fontWeight = FontWeight.Bold,
                                    color = TextPrimary
                                )
                            )
                            Text(
                                text = "Gérez votre plateforme Medika",
                                style = MaterialTheme.typography.bodyMedium,
                                color = TextSecondary
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            // ── Stats Grid (2x2) ──
            AnimatedVisibility(
                visible = true,
                enter = fadeIn(animationSpec = androidx.compose.animation.core.tween(500, delayMillis = 100)) +
                        slideInVertically(
                            initialOffsetY = { 30 },
                            animationSpec = androidx.compose.animation.core.tween(500, delayMillis = 100)
                        )
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        StatCard(
                            modifier = Modifier.weight(1f),
                            title = "Médecins",
                            value = totalDoctors.toString(),
                            icon = Icons.Default.LocalHospital,
                            tint = Green500
                        )
                        StatCard(
                            modifier = Modifier.weight(1f),
                            title = "Consultations",
                            value = totalConsultations.toString(),
                            icon = Icons.AutoMirrored.Filled.Chat,
                            tint = Color(0xFF3B82F6) // Blue
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        StatCard(
                            modifier = Modifier.weight(1f),
                            title = "Patients",
                            value = "3",
                            icon = Icons.Default.People,
                            tint = SanteWarning
                        )
                        StatCard(
                            modifier = Modifier.weight(1f),
                            title = "Taux d'acceptation",
                            value = "${acceptanceRate}%",
                            icon = Icons.Default.TrendingUp,
                            tint = Green500
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(28.dp))

            // ── Gestion des Médecins ──
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
                        text = "Gestion des Médecins",
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    if (doctors.isEmpty()) {
                        AdminSectionEmptyState(
                            icon = Icons.Default.PersonAddDisabled,
                            message = "Aucun médecin enregistré"
                        )
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            doctors.forEach { doctor ->
                                AdminDoctorCard(
                                    doctor = doctor,
                                    onToggleAvailability = { isAvailable ->
                                        viewModel.toggleDoctorAvailability(doctor.id, isAvailable)
                                    }
                                )
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(28.dp))

            // ── Toutes les Consultations ──
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
                        text = "Toutes les Consultations",
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    // Filter Tab Row
                    TabRow(
                        selectedTabIndex = selectedFilter,
                        containerColor = SanteCard,
                        contentColor = PrimaryGreen,
                        divider = {}
                    ) {
                        filterTabs.forEachIndexed { index, title ->
                            Tab(
                                selected = selectedFilter == index,
                                onClick = { selectedFilter = index },
                                text = {
                                    Text(
                                        text = title,
                                        fontWeight = if (selectedFilter == index) FontWeight.Bold
                                        else FontWeight.Normal,
                                        color = if (selectedFilter == index) PrimaryGreen
                                        else TextSecondary
                                    )
                                }
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    if (filteredConsultations.isEmpty()) {
                        AdminSectionEmptyState(
                            icon = Icons.Default.SearchOff,
                            message = "Aucune consultation trouvée"
                        )
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            filteredConsultations.forEach { consultation ->
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

            Spacer(modifier = Modifier.height(16.dp))
        }

        // ── FAB: Créer un Médecin ──
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = androidx.compose.animation.core.tween(600, delayMillis = 500)) +
                    slideInVertically(
                        initialOffsetY = { 60 },
                        animationSpec = androidx.compose.animation.core.tween(600, delayMillis = 500)
                    ),
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 16.dp, bottom = 96.dp)
        ) {
            FloatingActionButton(
                onClick = { showCreateDoctorDialog = true },
                containerColor = PrimaryGreen,
                contentColor = Color.White,
                shape = CircleShape
            ) {
                Icon(
                    imageVector = Icons.Default.Add,
                    contentDescription = "Créer un médecin",
                    modifier = Modifier.size(28.dp)
                )
            }
        }

        // ── Create Doctor Dialog ──
        if (showCreateDoctorDialog) {
            CreateDoctorDialog(
                onDismiss = { showCreateDoctorDialog = false },
                onCreate = { name, specialty, licenseNumber, location, hospital, biography ->
                    viewModel.adminCreateDoctor(
                        name = name,
                        specialty = specialty,
                        licenseNumber = licenseNumber,
                        location = location,
                        hospital = hospital,
                        biography = biography
                    )
                    showCreateDoctorDialog = false
                }
            )
        }
    }
}

@Composable
private fun AdminDoctorCard(
    doctor: DoctorEntity,
    onToggleAvailability: (Boolean) -> Unit
) {
    var isAvailable by remember(doctor.isAvailable) { mutableStateOf(doctor.isAvailable) }

    DepthCard(modifier = Modifier.fillMaxWidth(), elevationLevel = 1) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Doctor info
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = doctor.name,
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        ),
                        maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    // Verified badge
                    Icon(
                        imageVector = Icons.Default.Verified,
                        contentDescription = "Vérifié",
                        modifier = Modifier.size(18.dp),
                        tint = Green500
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = doctor.specialty,
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary
                )
                Spacer(modifier = Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.Star,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp),
                        tint = SanteWarning
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = "${doctor.rating}",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextSecondary
                    )
                }
            }

            // Availability toggle
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                val dotColor by animateColorAsState(
                    targetValue = if (isAvailable) Green500 else TextSecondary,
                    animationSpec = androidx.compose.animation.core.tween(300),
                    label = "admin_dot_color"
                )
                Text(
                    text = if (isAvailable) "Disponible" else "Indisponible",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (isAvailable) Green700 else TextSecondary,
                    fontWeight = FontWeight.Medium
                )
                Spacer(modifier = Modifier.height(4.dp))
                Switch(
                    checked = isAvailable,
                    onCheckedChange = {
                        isAvailable = it
                        onToggleAvailability(it)
                    },
                    colors = SwitchDefaults.colors(
                        checkedTrackColor = Green500,
                        checkedThumbColor = Color.White,
                        uncheckedTrackColor = TextSecondary.copy(alpha = 0.3f)
                    )
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateDoctorDialog(
    onDismiss: () -> Unit,
    onCreate: (String, String, String, String, String, String) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var specialty by remember { mutableStateOf("") }
    var licenseNumber by remember { mutableStateOf("") }
    var location by remember { mutableStateOf("") }
    var hospital by remember { mutableStateOf("") }
    var biography by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = SanteCard,
        shape = RoundedCornerShape(20.dp),
        title = {
            Text(
                text = "Créer un Médecin",
                style = MaterialTheme.typography.titleLarge.copy(
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Nom complet") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PrimaryGreen,
                        focusedLabelColor = PrimaryGreen
                    )
                )
                OutlinedTextField(
                    value = specialty,
                    onValueChange = { specialty = it },
                    label = { Text("Spécialité") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PrimaryGreen,
                        focusedLabelColor = PrimaryGreen
                    )
                )
                OutlinedTextField(
                    value = licenseNumber,
                    onValueChange = { licenseNumber = it },
                    label = { Text("Numéro de licence") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PrimaryGreen,
                        focusedLabelColor = PrimaryGreen
                    )
                )
                OutlinedTextField(
                    value = location,
                    onValueChange = { location = it },
                    label = { Text("Localisation") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PrimaryGreen,
                        focusedLabelColor = PrimaryGreen
                    )
                )
                OutlinedTextField(
                    value = hospital,
                    onValueChange = { hospital = it },
                    label = { Text("Hôpital / Établissement") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PrimaryGreen,
                        focusedLabelColor = PrimaryGreen
                    )
                )
                OutlinedTextField(
                    value = biography,
                    onValueChange = { biography = it },
                    label = { Text("Biographie") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(100.dp),
                    shape = RoundedCornerShape(12.dp),
                    maxLines = 4,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PrimaryGreen,
                        focusedLabelColor = PrimaryGreen
                    )
                )
            }
        },
        confirmButton = {
            AnimatedButton(
                onClick = {
                    if (name.isNotBlank() && specialty.isNotBlank()) {
                        onCreate(name, specialty, licenseNumber, location, hospital, biography)
                    }
                },
                text = "Créer"
            )
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Annuler", color = TextSecondary)
            }
        }
    )
}

@Composable
private fun AdminSectionEmptyState(
    icon: ImageVector,
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