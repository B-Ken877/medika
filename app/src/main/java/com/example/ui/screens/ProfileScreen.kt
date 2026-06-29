package com.example.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.data.db.PatientProfileEntity
import com.example.ui.SanteViewModel
import com.example.ui.theme.*

@Composable
fun ProfileScreen(
    viewModel: SanteViewModel,
    onBack: () -> Unit
) {
    val profile by viewModel.patientProfile.collectAsStateWithLifecycle()
    var isEditing by remember { mutableStateOf(false) }
    var showSaved by remember { mutableStateOf(false) }

    // Form fields
    var name by remember { mutableStateOf("") }
    var age by remember { mutableStateOf("") }
    var gender by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var allergies by remember { mutableStateOf("") }
    var medications by remember { mutableStateOf("") }
    var history by remember { mutableStateOf("") }

    // Reset form when profile changes
    LaunchedEffect(profile) {
        if (profile != null) {
            name = profile!!.name
            age = profile!!.age.toString()
            gender = profile!!.gender
            phone = profile!!.phone
            email = profile!!.email
            allergies = profile!!.allergies
            medications = profile!!.medications
            history = profile!!.history
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(SanteBackground)
    ) {
        if (profile == null) {
            // No profile state
            Column(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Icon(
                    imageVector = Icons.Default.PersonOff,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = TextSecondary
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "Aucun profil",
                    style = MaterialTheme.typography.titleMedium,
                    color = TextPrimary
                )
                Spacer(modifier = Modifier.height(24.dp))
                Button(
                    onClick = onBack,
                    colors = ButtonDefaults.buttonColors(containerColor = PrimaryGreen),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("Se connecter", color = Color.White)
                }
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 80.dp)
            ) {
                // Top bar with back + edit
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp, bottom = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Retour",
                            tint = TextPrimary
                        )
                    }
                    IconButton(onClick = { isEditing = !isEditing }) {
                        Icon(
                            imageVector = if (isEditing) Icons.Default.Close else Icons.Default.Edit,
                            contentDescription = if (isEditing) "Annuler" else "Modifier",
                            tint = if (isEditing) SanteDanger else PrimaryGreen
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Profile Header
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    // Avatar
                    Box(
                        modifier = Modifier
                            .size(80.dp)
                            .clip(CircleShape)
                            .background(PrimaryGreen)
                            .border(3.dp, DarkGreen, CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        val firstLetter = if (name.isNotBlank()) name.first().uppercase() else "?"
                        Text(
                            text = firstLetter,
                            color = Color.White,
                            fontSize = 32.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    // Name
                    AnimatedContent(
                        targetState = name,
                        transitionSpec = { fadeIn() togetherWith fadeOut() }
                    ) { targetName ->
                        Text(
                            text = targetName,
                            style = MaterialTheme.typography.titleLarge.copy(
                                fontSize = 22.sp,
                                fontWeight = FontWeight.Bold
                            ),
                            color = TextPrimary
                        )
                    }

                    Spacer(modifier = Modifier.height(4.dp))

                    // Email
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Email,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = TextSecondary
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        AnimatedContent(
                            targetState = email,
                            transitionSpec = { fadeIn() togetherWith fadeOut() }
                        ) { targetEmail ->
                            Text(
                                text = targetEmail,
                                fontSize = 14.sp,
                                color = TextSecondary
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(2.dp))

                    // Phone
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Phone,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = TextSecondary
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        AnimatedContent(
                            targetState = phone,
                            transitionSpec = { fadeIn() togetherWith fadeOut() }
                        ) { targetPhone ->
                            Text(
                                text = targetPhone,
                                fontSize = 14.sp,
                                color = TextSecondary
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // --- Informations Personnelles Section ---
                Text(
                    text = "Informations Personnelles",
                    style = MaterialTheme.typography.titleSmall.copy(
                        fontWeight = FontWeight.SemiBold
                    ),
                    color = DarkGreen,
                    modifier = Modifier.padding(bottom = 8.dp)
                )

                Spacer(modifier = Modifier.height(4.dp))

                AnimatedContent(
                    targetState = isEditing,
                    transitionSpec = { fadeIn() togetherWith fadeOut() }
                ) { editing ->
                    if (editing) {
                        // Edit mode
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            ProfileEditField(label = "Nom complet", value = name, onValueChange = { name = it })
                            ProfileEditField(label = "Âge", value = age, onValueChange = { age = it })
                            ProfileEditField(label = "Sexe", value = gender, onValueChange = { gender = it })
                            ProfileEditField(label = "Téléphone", value = phone, onValueChange = { phone = it })
                            ProfileEditField(label = "Email", value = email, onValueChange = { email = it })
                        }
                    } else {
                        // View mode
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            ProfileViewCard(label = "Nom complet", value = name)
                            ProfileViewCard(label = "Âge", value = "$age ans")
                            ProfileViewCard(label = "Sexe", value = gender)
                            ProfileViewCard(label = "Téléphone", value = phone)
                            ProfileViewCard(label = "Email", value = email)
                        }
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // --- Santé Section ---
                Text(
                    text = "Santé",
                    style = MaterialTheme.typography.titleSmall.copy(
                        fontWeight = FontWeight.SemiBold
                    ),
                    color = DarkGreen,
                    modifier = Modifier.padding(bottom = 8.dp)
                )

                Spacer(modifier = Modifier.height(4.dp))

                AnimatedContent(
                    targetState = isEditing,
                    transitionSpec = { fadeIn() togetherWith fadeOut() }
                ) { editing ->
                    if (editing) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            ProfileEditField(
                                label = "Allergies",
                                value = allergies,
                                onValueChange = { allergies = it }
                            )
                            ProfileEditField(
                                label = "Médicaments actuels",
                                value = medications,
                                onValueChange = { medications = it }
                            )
                            ProfileEditField(
                                label = "Antécédents médicaux",
                                value = history,
                                onValueChange = { history = it }
                            )
                        }
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            // Allergies with warning icon if not empty
                            ProfileViewCard(
                                label = "Allergies",
                                value = allergies,
                                showWarning = allergies.isNotBlank() && allergies != "Aucune allergie connue"
                            )
                            ProfileViewCard(label = "Médicaments actuels", value = medications)
                            ProfileViewCard(label = "Antécédents médicaux", value = history)
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Save button (only in edit mode)
                AnimatedContent(
                    targetState = isEditing,
                    transitionSpec = { fadeIn() togetherWith fadeOut() }
                ) { editing ->
                    if (editing) {
                        AnimatedButton(
                            onClick = {
                                viewModel.updatePatientProfile(
                                    name = name,
                                    email = email,
                                    phone = phone,
                                    age = age.toIntOrNull() ?: 0,
                                    gender = gender,
                                    allergies = allergies,
                                    medications = medications,
                                    history = history
                                )
                                isEditing = false
                                showSaved = true
                            },
                            label = if (showSaved) "Sauvegardé ✓" else "Sauvegarder",
                            showCheckmark = showSaved
                        )
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Logout button
                TextButton(
                    onClick = { viewModel.logout() },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(
                        imageVector = Icons.Default.ExitToApp,
                        contentDescription = null,
                        tint = SanteDanger,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Déconnexion",
                        color = SanteDanger,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }
    }
}

// ─── Reusable Components ─────────────────────────────────────────────────────

@Composable
private fun DepthCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = SanteCard,
        shadowElevation = 1.dp,
        tonalElevation = 1.dp
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            content = content
        )
    }
}

@Composable
private fun ProfileViewCard(
    label: String,
    value: String,
    showWarning: Boolean = false
) {
    DepthCard {
        Text(
            text = label,
            fontSize = 12.sp,
            color = TextSecondary,
            fontWeight = FontWeight.Medium
        )
        Spacer(modifier = Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (showWarning) {
                Icon(
                    imageVector = Icons.Default.Warning,
                    contentDescription = "Attention",
                    modifier = Modifier.size(18.dp),
                    tint = SanteWarning
                )
                Spacer(modifier = Modifier.width(6.dp))
            }
            Text(
                text = value,
                fontSize = 15.sp,
                color = TextPrimary,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

@Composable
private fun ProfileEditField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit
) {
    DepthCard {
        Text(
            text = label,
            fontSize = 12.sp,
            color = TextSecondary,
            fontWeight = FontWeight.Medium
        )
        Spacer(modifier = Modifier.height(6.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp),
            textStyle = LocalTextStyle.current.copy(
                fontSize = 15.sp,
                color = TextPrimary
            ),
            shape = RoundedCornerShape(8.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = PrimaryGreen,
                unfocusedBorderColor = Green200,
                cursorColor = PrimaryGreen
            )
        )
    }
}

@Composable
private fun AnimatedButton(
    onClick: () -> Unit,
    label: String,
    showCheckmark: Boolean
) {
    val scale by animateFloatAsState(
        targetValue = if (showCheckmark) 1f else 0.95f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy),
        label = "save_button_scale"
    )

    Button(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .height(50.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = PrimaryGreen,
            contentColor = Color.White
        ),
        shape = RoundedCornerShape(12.dp)
    ) {
        if (showCheckmark) {
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = null,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
        }
        Text(
            text = label,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp
        )
    }
}