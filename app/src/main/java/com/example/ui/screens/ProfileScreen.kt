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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ui.SanteViewModel
import com.example.ui.theme.*

@Composable
fun ProfileScreen(
    viewModel: SanteViewModel,
    onBack: () -> Unit
) {
    val profile by viewModel.patientProfile.collectAsStateWithLifecycle()
    var notificationsEnabled by remember { mutableStateOf(true) }

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
            // ── Top App Bar ──────────────────────────────────────────────
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
                // Balance the back button
                Spacer(modifier = Modifier.size(48.dp))
            }

            Spacer(modifier = Modifier.height(8.dp))

            // ── Profile Header Card ──────────────────────────────────────
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
                    // Avatar circle
                    Box(
                        modifier = Modifier
                            .size(80.dp)
                            .clip(CircleShape)
                            .background(Green50),
                        contentAlignment = Alignment.Center
                    ) {
                        val initial = profile?.name
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

                    Spacer(modifier = Modifier.height(12.dp))

                    // Name
                    Text(
                        text = profile?.name?.ifBlank { "Utilisateur" } ?: "Utilisateur",
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontSize = 22.sp,
                            fontWeight = FontWeight.Bold
                        ),
                        color = TextPrimary
                    )

                    Spacer(modifier = Modifier.height(4.dp))

                    // Email / username
                    Text(
                        text = profile?.email?.ifBlank { "email@exemple.com" } ?: "email@exemple.com",
                        fontSize = 14.sp,
                        color = TextSecondary
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    // Edit profile button
                    TextButton(onClick = { /* TODO: navigate to edit */ }) {
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

            // ── Section 1: Mon Compte ────────────────────────────────────
            SectionCard(title = "Mon Compte") {
                SettingsRow(
                    icon = Icons.Default.Person,
                    label = "Nom",
                    value = profile?.name?.ifBlank { "—" } ?: "—",
                    onClick = { }
                )
                SettingsDivider()
                SettingsRow(
                    icon = Icons.Default.Email,
                    label = "Email",
                    value = profile?.email?.ifBlank { "—" } ?: "—",
                    onClick = { }
                )
                SettingsDivider()
                SettingsRow(
                    icon = Icons.Default.Phone,
                    label = "Téléphone",
                    value = profile?.phone?.ifBlank { "—" } ?: "—",
                    onClick = { }
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // ── Section 2: Préférences ───────────────────────────────────
            SectionCard(title = "Préférences") {
                SettingsRow(
                    icon = Icons.Default.Language,
                    label = "Langue",
                    value = "Français",
                    onClick = { }
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

            // ── Section 3: Sécurité ──────────────────────────────────────
            SectionCard(title = "Sécurité") {
                SettingsRow(
                    icon = Icons.Default.Lock,
                    label = "Changer le mot de passe",
                    onClick = { }
                )
                SettingsDivider()
                SettingsRow(
                    icon = Icons.Default.Security,
                    label = "Confidentialité",
                    onClick = { }
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // ── Section 4: À Propos ──────────────────────────────────────
            SectionCard(title = "À Propos") {
                SettingsRow(
                    icon = Icons.Default.Info,
                    label = "Version de l'app",
                    value = "1.0.0",
                    showChevron = false,
                    onClick = { }
                )
                SettingsDivider()
                SettingsRow(
                    icon = Icons.Default.Description,
                    label = "Conditions d'utilisation",
                    onClick = { }
                )
                SettingsDivider()
                SettingsRow(
                    icon = Icons.Default.Policy,
                    label = "Politique de confidentialité",
                    onClick = { }
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            // ── Logout Button ────────────────────────────────────────────
            OutlinedButton(
                onClick = { viewModel.logout() },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .height(50.dp),
                shape = RoundedCornerShape(12.dp),
                border = androidx.compose.foundation.BorderStroke(1.5.dp, SanteDanger),
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
                    text = "Se déconnecter",
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp
                )
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

// ─── Section Card ────────────────────────────────────────────────────────────

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

// ─── Settings Row ────────────────────────────────────────────────────────────

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

// ─── Settings Toggle Row ─────────────────────────────────────────────────────

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

// ─── Settings Divider ────────────────────────────────────────────────────────

@Composable
private fun SettingsDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(start = 36.dp),
        thickness = 0.5.dp,
        color = Green100.copy(alpha = 0.6f)
    )
}
