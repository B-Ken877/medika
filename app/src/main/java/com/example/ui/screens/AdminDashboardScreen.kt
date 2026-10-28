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
import androidx.compose.foundation.layout.fillMaxHeight
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.AttachMoney

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminDashboardScreen(
    viewModel: SanteViewModel,
    onNavigate: (String) -> Unit
) {
    val doctors by viewModel.allDoctors.collectAsStateWithLifecycle()
    val consultations by viewModel.allConsultations.collectAsStateWithLifecycle()
    val specialtyPrices by viewModel.specialtyPrices.collectAsStateWithLifecycle()
    var selectedFilter by remember { mutableStateOf(0) }

    // Fetch specialty prices for finance calculations
    LaunchedEffect(Unit) {
        viewModel.fetchSpecialtyPrices()
    }

    // ── Admin Finance Calculations ──
    val completedConsultations = consultations.filter { it.status == "TERMINE" }
    val now = java.util.Calendar.getInstance()
    val currentMonth = now.get(java.util.Calendar.MONTH)
    val currentYear = now.get(java.util.Calendar.YEAR)
    val monthlyCompleted = completedConsultations.filter {
        val cal = java.util.Calendar.getInstance().apply { timeInMillis = it.timestamp }
        cal.get(java.util.Calendar.MONTH) == currentMonth && cal.get(java.util.Calendar.YEAR) == currentYear
    }

    fun calcRevenue(consList: List<com.example.data.db.ConsultationEntity>): Triple<Int, Int, Int> {
        var gross = 0
        for (c in consList) {
            val price = specialtyPrices[c.specialtyNeeded] ?: 0
            gross += price
        }
        return Triple(gross, (gross * 0.75).toInt(), (gross * 0.25).toInt())
    }

    val (totalGross, totalDoctor, totalMedika) = calcRevenue(completedConsultations)
    val (monthlyGross, monthlyDoctor, monthlyMedika) = calcRevenue(monthlyCompleted)
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

            // ── FINANCE SECTION — Revenue breakdown ──
            AnimatedVisibility(
                visible = true,
                enter = fadeIn(animationSpec = androidx.compose.animation.core.tween(500, delayMillis = 150)) +
                        slideInVertically(
                            initialOffsetY = { 30 },
                            animationSpec = androidx.compose.animation.core.tween(500, delayMillis = 150)
                        )
            ) {
                Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                    Text(
                        text = "Finances",
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    AdminFinanceCard(
                        monthlyGross = monthlyGross,
                        monthlyMedika = monthlyMedika,
                        monthlyDoctor = monthlyDoctor,
                        monthlyCount = monthlyCompleted.size,
                        totalGross = totalGross,
                        totalMedika = totalMedika,
                        totalDoctor = totalDoctor,
                        totalCount = completedConsultations.size
                    )
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

// ═══════════════════════════════════════════════════════════════════
// AdminFinanceCard — Shows Medika 25% commission and doctor 75% earnings
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
private fun AdminFinanceCard(
    monthlyGross: Int,
    monthlyMedika: Int,
    monthlyDoctor: Int,
    monthlyCount: Int,
    totalGross: Int,
    totalMedika: Int,
    totalDoctor: Int,
    totalCount: Int,
) {
    DepthCard(modifier = Modifier.fillMaxWidth(), elevationLevel = 1) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.AttachMoney,
                        contentDescription = null,
                        tint = PrimaryGreen,
                        modifier = Modifier.size(22.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Revenus de la Plateforme",
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                    )
                }
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = Color(0xFFFFF7ED)
                ) {
                    Text(
                        text = "25% Medika",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFF92400E),
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("Ce mois", style = MaterialTheme.typography.labelMedium, color = TextSecondary)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("$monthlyGross HTG", style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold, color = TextPrimary))
                    Spacer(modifier = Modifier.height(6.dp))
                    Surface(shape = RoundedCornerShape(8.dp), color = Color(0xFFECFDF5)) {
                        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Medika (25%)", style = MaterialTheme.typography.labelSmall, color = TextSecondary)
                            Text("$monthlyMedika HTG", style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold, color = PrimaryGreen))
                        }
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                    Surface(shape = RoundedCornerShape(8.dp), color = Neutral100) {
                        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Medecins (75%)", style = MaterialTheme.typography.labelSmall, color = TextSecondary)
                            Text("$monthlyDoctor HTG", style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold, color = TextPrimary))
                        }
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("$monthlyCount consultation${if (monthlyCount != 1) "s" else ""}", style = MaterialTheme.typography.labelSmall, color = TextTertiary)
                }

                Box(modifier = Modifier.width(1.dp).fillMaxHeight().background(Color(0xFFE0E0E0)))

                Column(
                    modifier = Modifier.weight(1f),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("Total", style = MaterialTheme.typography.labelMedium, color = TextSecondary)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("$totalGross HTG", style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold, color = TextPrimary))
                    Spacer(modifier = Modifier.height(6.dp))
                    Surface(shape = RoundedCornerShape(8.dp), color = Color(0xFFECFDF5)) {
                        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Medika (25%)", style = MaterialTheme.typography.labelSmall, color = TextSecondary)
                            Text("$totalMedika HTG", style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold, color = PrimaryGreen))
                        }
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                    Surface(shape = RoundedCornerShape(8.dp), color = Neutral100) {
                        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Medecins (75%)", style = MaterialTheme.typography.labelSmall, color = TextSecondary)
                            Text("$totalDoctor HTG", style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold, color = TextPrimary))
                        }
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("$totalCount consultation${if (totalCount != 1) "s" else ""}", style = MaterialTheme.typography.labelSmall, color = TextTertiary)
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AdminDoctorCard
// ═══════════════════════════════════════════════════════════════════════════════

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