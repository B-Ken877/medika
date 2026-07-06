package com.example.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Healing
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Surface
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.content.Intent
import com.example.ui.screens.PaymentActivity
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.data.db.DoctorEntity
import com.example.ui.IntakeState
import com.example.ui.SanteViewModel
import com.example.ui.components.AnimatedButton
import com.example.ui.components.DoctorCard
import com.example.ui.components.ShimmerBox
import com.example.ui.theme.Green100
import com.example.ui.theme.Green50
import com.example.ui.theme.Green200
import com.example.ui.theme.Neutral100
import com.example.ui.theme.Neutral200
import com.example.ui.theme.Green500
import com.example.ui.theme.Green700
import com.example.ui.theme.PrimaryGreen
import com.example.ui.theme.SanteDanger
import com.example.ui.theme.SanteWarning
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary

private data class DoctorCategory(
    val key: String,
    val label: String,
    val icon: ImageVector,
    val color: Color
)

private val doctorCategories = listOf(
    DoctorCategory("Medecine Generale", "Medecine Generale", Icons.Default.People, PrimaryGreen),
    DoctorCategory("Cardiologie", "Cardiologie", Icons.Default.Healing, Color(0xFFE74C3C)),
    DoctorCategory("Dermatologie", "Dermatologie", Icons.Default.Healing, Color(0xFF9B59B6)),
    DoctorCategory("Pediatrie", "Pediatrie", Icons.Default.People, Color(0xFF3498DB)),
    DoctorCategory("Gynecologie", "Gynecologie", Icons.Default.Healing, Color(0xFFE91E63)),
    DoctorCategory("Ophtalmologie", "Ophtalmologie", Icons.Default.Healing, Color(0xFF00BCD4)),
    DoctorCategory("Orthopedie", "Orthopedie", Icons.Default.Healing, Color(0xFF795548)),
    DoctorCategory("Neurologie", "Neurologie", Icons.Default.Healing, Color(0xFF607D8B)),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SymptomIntakeScreen(viewModel: SanteViewModel) {
    val intakeState by viewModel.intakeState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var symptomText by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf<DoctorCategory?>(null) }
    var pendingDoctor by remember { mutableStateOf<DoctorEntity?>(null) }
    var pendingSymptom by remember { mutableStateOf("") }
    var pendingCategory by remember { mutableStateOf("") }

    // Payment result launcher
    val paymentLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            val success = result.data?.getBooleanExtra(PaymentActivity.EXTRA_PAYMENT_SUCCESS, false) ?: false
            val txId = result.data?.getStringExtra(PaymentActivity.EXTRA_TRANSACTION_ID) ?: ""
            if (success && pendingDoctor != null) {
                viewModel.selectDoctorAndSendRequest(
                    doctor = pendingDoctor!!,
                    symptomText = pendingSymptom,
                    category = pendingCategory
                )
                pendingDoctor = null
            }
        } else {
            // Payment cancelled or failed
            pendingDoctor = null
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
    ) {
        // Decorative green orb
        Box(
            modifier = Modifier
                .size(180.dp)
                .offset(x = 200.dp, y = (-50).dp)
                .background(Green100.copy(alpha = 0.15f), CircleShape)
                .alpha(0.4f)
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 24.dp)
        ) {
            when (val state = intakeState) {
                is IntakeState.Idle -> IntakeFormContent(
                    symptomText = symptomText,
                    onSymptomTextChanged = { symptomText = it },
                    selectedCategory = selectedCategory,
                    onSelectCategory = { selectedCategory = it },
                    onSubmit = {
                        val cat = selectedCategory
                        if (cat != null) {
                            viewModel.findDoctorsByCategory(symptomText, cat.key)
                        }
                    }
                )

                is IntakeState.Loading -> LoadingContent()

                is IntakeState.DoctorsLoaded -> DoctorsListContent(
                    category = state.category,
                    doctors = state.doctors,
                    symptomText = symptomText,
                    onSelectDoctor = { doctor ->
                        // Launch MonCash payment before creating consultation
                        pendingDoctor = doctor
                        pendingSymptom = symptomText
                        pendingCategory = state.category
                        val orderId = "MC_${System.currentTimeMillis()}_${doctor.id}"
                        val intent = PaymentActivity.newIntent(context, "Dr. ${doctor.name}", orderId, doctor.specialty)
                        paymentLauncher.launch(intent)
                    },
                    onReset = {
                        viewModel.resetIntake()
                        selectedCategory = null
                    }
                )

                is IntakeState.NoDoctors -> NoDoctorsContent(
                    category = state.category,
                    onReset = {
                        viewModel.resetIntake()
                        selectedCategory = null
                    }
                )

                is IntakeState.Error -> ErrorContent(
                    message = state.message,
                    onRetry = {
                        viewModel.resetIntake()
                        selectedCategory = null
                    }
                )
            }
        }
    }
}

// ─── Intake Form ─────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun IntakeFormContent(
    symptomText: String,
    onSymptomTextChanged: (String) -> Unit,
    selectedCategory: DoctorCategory?,
    onSelectCategory: (DoctorCategory) -> Unit,
    onSubmit: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Header
        Box(
            modifier = Modifier
                .size(56.dp)
                .background(PrimaryGreen.copy(alpha = 0.12f), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.Search,
                contentDescription = null,
                tint = PrimaryGreen,
                modifier = Modifier.size(26.dp)
            )
        }

        Spacer(modifier = Modifier.height(14.dp))

        Text(
            text = "Trouvez un docteur",
            style = MaterialTheme.typography.headlineMedium,
            color = TextPrimary
        )

        Spacer(modifier = Modifier.height(6.dp))

        Text(
            text = "Decrivez vos symptomes et choisissez une specialite",
            fontSize = 14.sp,
            color = TextSecondary,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(24.dp))

        // Symptom text field
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, Neutral200, RoundedCornerShape(16.dp)),
            shape = RoundedCornerShape(16.dp),
            color = Neutral100
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Qu'est-ce qui ne va pas ?",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary
                )
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = symptomText,
                    onValueChange = onSymptomTextChanged,
                    placeholder = {
                        Text("Ex: J'ai des maux de tete depuis 3 jours, avec de la fievre...")
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(120.dp),
                    maxLines = 5,
                    minLines = 3,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PrimaryGreen,
                        focusedLabelColor = PrimaryGreen,
                        cursorColor = PrimaryGreen,
                        unfocusedBorderColor = Green200,
                        unfocusedContainerColor = Color.White,
                        focusedContainerColor = Color.White
                    ),
                    shape = RoundedCornerShape(14.dp)
                )
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Category selector
        Text(
            text = "Choisissez une specialite",
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            color = TextPrimary
        )

        Spacer(modifier = Modifier.height(12.dp))

        // Category chips in a 2-column grid
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            doctorCategories.chunked(2).forEach { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    row.forEach { category ->
                        val isSelected = selectedCategory?.key == category.key
                        Surface(
                            onClick = { onSelectCategory(category) },
                            modifier = Modifier
                                .weight(1f)
                                .border(
                                    1.dp,
                                    if (isSelected) PrimaryGreen else Neutral200,
                                    RoundedCornerShape(12.dp)
                                ),
                            shape = RoundedCornerShape(12.dp),
                            color = if (isSelected) PrimaryGreen.copy(alpha = 0.06f) else Color.White
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(28.dp)
                                        .background(
                                            if (isSelected) PrimaryGreen else category.color.copy(alpha = 0.1f),
                                            CircleShape
                                        ),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        imageVector = category.icon,
                                        contentDescription = null,
                                        tint = if (isSelected) Color.White else category.color,
                                        modifier = Modifier.size(15.dp)
                                    )
                                }
                                Spacer(modifier = Modifier.width(10.dp))
                                Text(
                                    text = category.label,
                                    fontSize = 13.sp,
                                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
                                    color = if (isSelected) PrimaryGreen else TextPrimary,
                                    maxLines = 1
                                )
                            }
                        }
                    }
                    // Fill empty space if odd number
                    if (row.size == 1) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        // Find doctor button
        val canSubmit = symptomText.isNotBlank() && selectedCategory != null
        AnimatedButton(
            text = "Trouver un docteur",
            onClick = onSubmit,
            modifier = Modifier.fillMaxWidth(),
            enabled = canSubmit
        )

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            text = "Recherche par specialite medicale",
            fontSize = 12.sp,
            color = TextSecondary
        )
    }
}

// ─── Loading State ───────────────────────────────────────────────────────────

@Composable
private fun LoadingContent() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 60.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "Recherche de docteurs...",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Medium,
            color = TextSecondary
        )

        Spacer(modifier = Modifier.height(24.dp))

        // Clean shimmer placeholders
        repeat(3) {
            ShimmerBox(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(96.dp)
                    .padding(vertical = 6.dp)
            )
        }
    }
}

// ─── Doctors List ────────────────────────────────────────────────────────────

@Composable
private fun DoctorsListContent(
    category: String,
    doctors: List<DoctorEntity>,
    symptomText: String,
    onSelectDoctor: (DoctorEntity) -> Unit,
    onReset: () -> Unit
) {
    AnimatedVisibility(
        visible = true,
        enter = slideInVertically(initialOffsetY = { it / 3 }) + fadeIn(),
        exit = slideOutVertically() + fadeOut()
    ) {
        Column {
            // Header with category badge
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = Neutral100
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(42.dp)
                            .background(PrimaryGreen, RoundedCornerShape(10.dp)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.People,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(22.dp)
                        )
                    }
                    Spacer(modifier = Modifier.width(14.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = category,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                        Text(
                            text = "${doctors.size} docteur${if (doctors.size > 1) "s" else ""} disponible${if (doctors.size > 1) "s" else ""}",
                            fontSize = 13.sp,
                            color = Green700,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            // Doctors list - vertical for better mobile UX
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                doctors.forEach { doctor ->
                    DoctorCard(
                        doctor = doctor,
                        onClick = { onSelectDoctor(doctor) }
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            TextButton(
                onClick = onReset,
                modifier = Modifier.align(Alignment.CenterHorizontally)
            ) {
                Text("Retour", color = PrimaryGreen, fontWeight = FontWeight.Medium)
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

// ─── No Doctors State ────────────────────────────────────────────────────────

@Composable
private fun NoDoctorsContent(
    category: String,
    onReset: () -> Unit
) {
    AnimatedVisibility(
        visible = true,
        enter = fadeIn(),
        exit = fadeOut()
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 60.dp),
            shape = RoundedCornerShape(20.dp),
            color = SanteWarning.copy(alpha = 0.06f)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    modifier = Modifier
                        .size(80.dp)
                        .background(SanteWarning.copy(alpha = 0.12f), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.People,
                        contentDescription = null,
                        tint = SanteWarning,
                        modifier = Modifier.size(40.dp)
                    )
                }

                Spacer(modifier = Modifier.height(20.dp))

                Text(
                    text = "Aucun docteur disponible",
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "Il n'y a actuellement aucun docteur en ligne pour la specialite \"$category\". Veuillez essayer une autre specialite ou revenir plus tard.",
                    fontSize = 14.sp,
                    color = TextSecondary,
                    textAlign = TextAlign.Center,
                    lineHeight = 22.sp
                )

                Spacer(modifier = Modifier.height(24.dp))

                AnimatedButton(
                    text = "Changer de specialite",
                    onClick = onReset,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}

// ─── Error State ───────────────────────────────────────────────────────────────

@Composable
private fun ErrorContent(
    message: String,
    onRetry: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 60.dp),
        shape = RoundedCornerShape(20.dp),
        color = SanteDanger.copy(alpha = 0.04f)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier
                    .size(72.dp)
                    .background(SanteDanger.copy(alpha = 0.1f), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.ErrorOutline,
                    contentDescription = null,
                    tint = SanteDanger,
                    modifier = Modifier.size(40.dp)
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            Text(
                text = "Erreur",
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = message,
                fontSize = 14.sp,
                color = TextSecondary,
                textAlign = TextAlign.Center,
                lineHeight = 22.sp
            )

            Spacer(modifier = Modifier.height(24.dp))

            AnimatedButton(
                text = "Reessayer",
                onClick = onRetry,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}