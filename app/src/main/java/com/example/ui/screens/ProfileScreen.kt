package com.example.ui.screens

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ui.AuthState
import com.example.ui.SanteViewModel
import com.example.ui.theme.*
import coil.compose.AsyncImage
import com.example.data.api.MedikaNetwork
import coil.request.ImageRequest

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    viewModel: SanteViewModel,
    onBack: () -> Unit,
    onNavigate: (String) -> Unit = {}
) {
    val authState by viewModel.authState.collectAsStateWithLifecycle()
    val profile by viewModel.patientProfile.collectAsStateWithLifecycle()
    var notificationsEnabled by remember { mutableStateOf(true) }

    // Doctor info for doctor profile
    val doctorProfile = (authState as? AuthState.DoctorAuthenticated)?.doctor

    // Edit profile dialog state
    var showEditDialog by remember { mutableStateOf(false) }
    var showPasswordDialog by remember { mutableStateOf(false) }
    var isUploadingAvatar by remember { mutableStateOf(false) }

    // Edit fields
    var editName by remember { mutableStateOf("") }
    var editEmail by remember { mutableStateOf("") }
    var editPhone by remember { mutableStateOf("") }

    // Password fields
    var oldPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var passwordError by remember { mutableStateOf("") }

    val context = LocalContext.current
    val isDoctor = authState is AuthState.DoctorAuthenticated
    val serverUser = when (val auth = authState) {
        is AuthState.PatientAuthenticated -> auth.serverUser
        is AuthState.DoctorAuthenticated -> auth.serverUser
        else -> null
    }
    val displayName = if (isDoctor) doctorProfile?.name else profile?.name
    val displayEmail = serverUser?.email
    val displayPhone = if (isDoctor) serverUser?.phone else profile?.phone
    val avatarUrl = serverUser?.avatar_url

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(SanteBackground)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
        ) {
            // ── Top App Bar ──────────────────────────────────────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 4.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onBack) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Retour",
                        tint = TextPrimary
                    )
                }
                Spacer(modifier = Modifier.weight(1f))
                Text(
                    text = "Profil",
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontWeight = FontWeight.SemiBold
                    ),
                    color = TextPrimary
                )
                Spacer(modifier = Modifier.weight(1f))
                Spacer(modifier = Modifier.size(48.dp))
            }

            Spacer(modifier = Modifier.height(8.dp))

            // ── Profile Header Card ──────────────────────────────
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(
                        elevation = 2.dp,
                        shape = RoundedCornerShape(bottomStart = 24.dp, bottomEnd = 24.dp)
                    ),
                shape = RoundedCornerShape(bottomStart = 24.dp, bottomEnd = 24.dp),
                color = Color.White
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 28.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    // Photo picker launcher
                    val galleryLauncher = rememberLauncherForActivityResult(
                        contract = ActivityResultContracts.GetContent()
                    ) { uri: Uri? ->
                        if (uri != null) {
                            isUploadingAvatar = true
                            viewModel.uploadProfilePicture(uri, context) { success, error ->
                                isUploadingAvatar = false
                                if (success) {
                                    Toast.makeText(context, "Photo de profil mise \u00e0 jour!", Toast.LENGTH_SHORT).show()
                                } else {
                                    Toast.makeText(context, "Erreur: ${error ?: "inconnue"}", Toast.LENGTH_LONG).show()
                                }
                            }
                        }
                    }

                    Box(
                        modifier = Modifier
                            .size(90.dp)
                            .clip(CircleShape)
                            .background(Green50)
                            .then(
                                if (!isUploadingAvatar) Modifier.clickable { galleryLauncher.launch("image/*") }
                                else Modifier
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        if (avatarUrl != null) {
                            AsyncImage(
                                model = ImageRequest.Builder(context)
                                    .data(if (avatarUrl.startsWith("http")) avatarUrl else MedikaNetwork.BASE_URL.removeSuffix("/") + avatarUrl)
                                    .crossfade(true)
                                    .build(),
                                contentDescription = "Photo de profil",
                                modifier = Modifier.size(90.dp)
                            )
                        } else {
                            val initial = displayName
                                ?.takeIf { it.isNotBlank() }
                                ?.firstOrNull()
                                ?.uppercaseChar() ?: "?"
                            Text(
                                text = initial.toString(),
                                color = PrimaryGreen,
                                fontSize = 32.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        if (isUploadingAvatar) {
                            Box(
                                modifier = Modifier
                                    .size(90.dp)
                                    .clip(CircleShape)
                                    .background(Color.Black.copy(alpha = 0.4f)),
                                contentAlignment = Alignment.Center
                            ) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(32.dp),
                                    color = Color.White,
                                    strokeWidth = 3.dp
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = if (avatarUrl != null) "Modifier la photo" else "Ajouter une photo",
                        color = PrimaryGreen,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.clickable { galleryLauncher.launch("image/*") }
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    Text(
                        text = displayName ?: "Utilisateur",
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontSize = 22.sp,
                            fontWeight = FontWeight.Bold
                        ),
                        color = TextPrimary
                    )

                    Spacer(modifier = Modifier.height(4.dp))

                    Text(
                        text = displayEmail ?: "email@exemple.com",
                        fontSize = 14.sp,
                        color = TextSecondary
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    TextButton(onClick = {
                        editName = displayName ?: ""
                        editEmail = displayEmail ?: ""
                        editPhone = displayPhone ?: ""
                        showEditDialog = true
                    }) {
                        Text(
                            text = "Modifier le profil",
                            color = PrimaryGreen,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 14.sp
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // ── Section 1: Mon Compte ────────────────────────────
            SectionCard(title = "Mon Compte") {
                SettingsRow(
                    icon = Icons.Default.Person,
                    label = "Nom",
                    value = displayName ?: "\u2014",
                    onClick = {
                        editName = displayName ?: ""
                        editEmail = displayEmail ?: ""
                        editPhone = displayPhone ?: ""
                        showEditDialog = true
                    }
                )
                SettingsDivider()
                SettingsRow(
                    icon = Icons.Default.Email,
                    label = "Email",
                    value = displayEmail ?: "\u2014",
                    onClick = {
                        editName = displayName ?: ""
                        editEmail = displayEmail ?: ""
                        editPhone = displayPhone ?: ""
                        showEditDialog = true
                    }
                )
                SettingsDivider()
                SettingsRow(
                    icon = Icons.Default.Phone,
                    label = "T\u00e9l\u00e9phone",
                    value = displayPhone ?: "\u2014",
                    onClick = {
                        editName = displayName ?: ""
                        editEmail = displayEmail ?: ""
                        editPhone = displayPhone ?: ""
                        showEditDialog = true
                    }
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // ── Section 2: Pr\u00e9f\u00e9rences ─────────────────────────────
            SectionCard(title = "Pr\u00e9f\u00e9rences") {
                SettingsRow(
                    icon = Icons.Default.Language,
                    label = "Langue",
                    value = "Fran\u00e7ais",
                    showChevron = false,
                    onClick = { /* Language selection coming soon */ }
                )
                SettingsDivider()
                SettingsToggleRow(
                    icon = Icons.Default.Notifications,
                    label = "Notifications",
                    checked = notificationsEnabled,
                    onCheckedChange = { notificationsEnabled = it }
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // ── Section 3: S\u00e9curit\u00e9 ──────────────────────────────────
            SectionCard(title = "S\u00e9curit\u00e9") {
                SettingsRow(
                    icon = Icons.Default.Lock,
                    label = "Changer le mot de passe",
                    onClick = {
                        oldPassword = ""
                        newPassword = ""
                        confirmPassword = ""
                        passwordError = ""
                        showPasswordDialog = true
                    }
                )
                SettingsDivider()
                SettingsRow(
                    icon = Icons.Default.Security,
                    label = "Confidentialit\u00e9",
                    onClick = {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://medika.app/privacy"))
                        context.startActivity(intent)
                    }
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // ── Section 4: \u00c0 Propos ──────────────────────────────────
            SectionCard(title = "\u00c0 Propos") {
                SettingsRow(
                    icon = Icons.Default.Info,
                    label = "Version de l\u2019app",
                    value = "1.0.0",
                    showChevron = false,
                    onClick = { }
                )
                SettingsDivider()
                SettingsRow(
                    icon = Icons.Default.Description,
                    label = "Conditions d\u2019utilisation",
                    onClick = {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://medika.app/terms"))
                        context.startActivity(intent)
                    }
                )
                SettingsDivider()
                SettingsRow(
                    icon = Icons.Default.Policy,
                    label = "Politique de confidentialit\u00e9",
                    onClick = {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://medika.app/privacy-policy"))
                        context.startActivity(intent)
                    }
                )
            }

            Spacer(modifier = Modifier.height(24.dp))


            // ── Customer Care ─────────────────────────────────
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = Color.White,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .clickable { onNavigate("ticket_list") }
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Surface(shape = CircleShape, color = Color(0xFFDBEAFE)) {
                        Box(modifier = Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.HeadsetMic, contentDescription = null, modifier = Modifier.size(20.dp), tint = Color(0xFF2563EB))
                        }
                    }
                    Spacer(modifier = Modifier.width(14.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Service Client", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = TextPrimary)
                        Text("Obtenez de l\'aide et support", fontSize = 12.sp, color = TextSecondary)
                    }
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, modifier = Modifier.size(20.dp), tint = Neutral400)
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // ── Logout Button ────────────────────────────────────
            OutlinedButton(
                onClick = { viewModel.logout() },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .height(50.dp),
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.5.dp, SanteDanger),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = SanteDanger
                )
            ) {
                Icon(
                    imageVector = Icons.Default.Logout,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Se d\u00e9connecter",
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp
                )
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }

    // ── Edit Profile Dialog ──────────────────────────────────
    if (showEditDialog) {
        AlertDialog(
            onDismissRequest = { showEditDialog = false },
            title = { Text("Modifier le profil", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = editName,
                        onValueChange = { editName = it },
                        label = { Text("Nom complet") },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    )
                    OutlinedTextField(
                        value = editEmail,
                        onValueChange = { editEmail = it },
                        label = { Text("Email") },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    )
                    OutlinedTextField(
                        value = editPhone,
                        onValueChange = { editPhone = it },
                        label = { Text("T\u00e9l\u00e9phone") },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    if (editName.isNotBlank()) {
                        if (isDoctor) {
                            viewModel.updateDoctorProfile(
                                name = editName.trim(),
                                email = editEmail.trim(),
                                phone = editPhone.trim()
                            )
                        } else {
                            viewModel.updatePatientProfile(
                                name = editName.trim(),
                                email = editEmail.trim(),
                                phone = editPhone.trim(),
                                age = 0,
                                gender = "",
                                allergies = "",
                                medications = "",
                                history = ""
                            )
                        }
                        showEditDialog = false
                    }
                }) {
                    Text("Enregistrer", color = PrimaryGreen, fontWeight = FontWeight.SemiBold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showEditDialog = false }) {
                    Text("Annuler", color = TextSecondary)
                }
            }
        )
    }

    // ── Change Password Dialog ───────────────────────────────
    if (showPasswordDialog) {
        AlertDialog(
            onDismissRequest = { showPasswordDialog = false },
            title = { Text("Changer le mot de passe", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = oldPassword,
                        onValueChange = { oldPassword = it; passwordError = "" },
                        label = { Text("Ancien mot de passe") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    )
                    OutlinedTextField(
                        value = newPassword,
                        onValueChange = { newPassword = it; passwordError = "" },
                        label = { Text("Nouveau mot de passe") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    )
                    OutlinedTextField(
                        value = confirmPassword,
                        onValueChange = { confirmPassword = it; passwordError = "" },
                        label = { Text("Confirmer le mot de passe") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    )
                    if (passwordError.isNotBlank()) {
                        Text(passwordError, color = SanteDanger, fontSize = 13.sp)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    when {
                        oldPassword.isBlank() -> passwordError = "Entrez l\u2019ancien mot de passe"
                        newPassword.length < 4 -> passwordError = "Le nouveau mot de passe doit avoir au moins 4 caract\u00e8res"
                        newPassword != confirmPassword -> passwordError = "Les mots de passe ne correspondent pas"
                        else -> {
                            viewModel.changePassword(oldPassword, newPassword)
                            showPasswordDialog = false
                        }
                    }
                }) {
                    Text("Changer", color = PrimaryGreen, fontWeight = FontWeight.SemiBold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showPasswordDialog = false }) {
                    Text("Annuler", color = TextSecondary)
                }
            }
        )
    }
}

// ─── Section Card ────────────────────────────────────────────────────

@Composable
private fun SectionCard(
    title: String,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
    ) {
        Text(
            text = title,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            color = PrimaryGreenDark,
            modifier = Modifier.padding(bottom = 8.dp, start = 4.dp)
        )
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(
                    elevation = 2.dp,
                    shape = RoundedCornerShape(16.dp)
                ),
            shape = RoundedCornerShape(16.dp),
            color = Color.White
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                content = content
            )
        }
    }
}

// ─── Settings Row ────────────────────────────────────────────────────

@Composable
private fun SettingsRow(
    icon: ImageVector,
    label: String,
    value: String? = null,
    showChevron: Boolean = true,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(22.dp),
            tint = PrimaryGreen
        )
        Spacer(modifier = Modifier.width(14.dp))
        Text(
            text = label,
            fontSize = 15.sp,
            color = TextPrimary,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f)
        )
        if (value != null) {
            Text(
                text = value,
                fontSize = 14.sp,
                color = TextSecondary
            )
            Spacer(modifier = Modifier.width(8.dp))
        }
        if (showChevron) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                modifier = Modifier.size(22.dp),
                tint = TextSecondary.copy(alpha = 0.5f)
            )
        }
    }
}

// ─── Settings Toggle Row ────────────────────────────────────────────

@Composable
private fun SettingsToggleRow(
    icon: ImageVector,
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(22.dp),
            tint = PrimaryGreen
        )
        Spacer(modifier = Modifier.width(14.dp))
        Text(
            text = label,
            fontSize = 15.sp,
            color = TextPrimary,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f)
        )
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = PrimaryGreen,
                uncheckedThumbColor = Color.White,
                uncheckedTrackColor = Green200
            )
        )
    }
}

// ─── Settings Divider ────────────────────────────────────────────────

@Composable
private fun SettingsDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(start = 36.dp),
        thickness = 0.5.dp,
        color = Green100.copy(alpha = 0.6f)
    )
}
