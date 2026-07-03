package com.example.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ui.SanteViewModel
import com.example.ui.theme.*

private val PrimaryGreenDark = Color(0xFF0D7A35)

data class AppNotification(
    val id: String,
    val type: String, // "consultation", "message", "system", "payment"
    val title: String,
    val body: String,
    val timestamp: Long,
    val isRead: Boolean = false,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(
    viewModel: SanteViewModel,
    onNavigate: (String) -> Unit = {},
    onBack: () -> Unit
) {
    val consultations by viewModel.allConsultations.collectAsStateWithLifecycle()
    val activeConsultationId by viewModel.activeConsultationId.collectAsStateWithLifecycle()
    val messages by viewModel.activeMessages.collectAsStateWithLifecycle()
    val authState by viewModel.authState.collectAsStateWithLifecycle()

    // Build real notifications from consultations and messages
    val notifications = remember(consultations, messages, activeConsultationId) {
        val list = mutableListOf<AppNotification>()
        var notifId = 0

        // Consultation status notifications
        for (c in consultations) {
            val timeStr = android.text.format.DateFormat.getMediumDateFormat(null).format(
                java.util.Date(c.timestamp)
            )
            when (c.status) {
                "RECHERCHE_MEDECIN" -> {
                    list.add(AppNotification(
                        id = "cons_${c.id}",
                        type = "consultation",
                        title = "Consultation en attente",
                        body = "Votre consultation \"${
                            c.description.take(50).ifBlank { "Sans description" }
                        }\" est en attente d'un m\u00e9decin.",
                        timestamp = c.timestamp,
                        isRead = c.status != "RECHERCHE_MEDECIN",
                    ))
                }
                "EN_COURS" -> {
                    list.add(AppNotification(
                        id = "cons_active_${c.id}",
                        type = "consultation",
                        title = "Consultation en cours",
                        body = "Un m\u00e9decin a accept\u00e9 votre consultation. Vous pouvez commencer la discussion.",
                        timestamp = c.timestamp,
                        isRead = false,
                    ))
                }
                "TERMINEE" -> {
                    list.add(AppNotification(
                        id = "cons_done_${c.id}",
                        type = "consultation",
                        title = "Consultation termin\u00e9e",
                        body = "Votre consultation a \u00e9t\u00e9 cl\u00f4tur\u00e9e.",
                        timestamp = c.timestamp,
                        isRead = true,
                    ))
                }
            }
            notifId++
        }

        // Recent message notifications (last 5 unread from others)
        val currentUserId = when (val auth = authState) {
            is com.example.ui.AuthState.PatientAuthenticated -> auth.serverUser.id
            is com.example.ui.AuthState.DoctorAuthenticated -> auth.serverUser.id
            else -> null
        }
        val unreadMsgs = messages
            .filter { it.senderId != currentUserId && it.text.isNotBlank() }
            .takeLast(5)
            .reversed()
        for (msg in unreadMsgs) {
            list.add(AppNotification(
                id = "msg_${msg.id}",
                type = "message",
                title = msg.senderName,
                body = msg.text.take(80),
                timestamp = msg.timestamp,
                isRead = false,
            ))
        }

        // System notifications
        list.add(AppNotification(
            id = "sys_welcome",
            type = "system",
            title = "Bienvenue sur Medika",
            body = "Votre plateforme de t\u00e9l\u00e9consultation m\u00e9dicale. Consultez un m\u00e9decin en quelques clics.",
            timestamp = System.currentTimeMillis() - 86400000,
            isRead = true,
        ))

        // Sort by timestamp descending
        list.sortedByDescending { it.timestamp }
    }

    var dismissedIds = remember { mutableStateListOf<String>() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(SanteBackground)
    ) {
        Column(
            modifier = Modifier.fillMaxSize()
        ) {
            // Top bar
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
                    text = "Notifications",
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontWeight = FontWeight.SemiBold
                    ),
                    color = TextPrimary
                )
                Spacer(modifier = Modifier.weight(1f))
                Spacer(modifier = Modifier.size(48.dp))
            }

            Spacer(modifier = Modifier.height(4.dp))

            // Notification count
            val visibleCount = notifications.filter { it.id !in dismissedIds }.size
            Text(
                text = "$visibleCount notification${if (visibleCount != 1) "s" else ""}",
                fontSize = 13.sp,
                color = TextSecondary,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
            )

            // Notification list
            if (notifications.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = Icons.Default.NotificationsNone,
                            contentDescription = null,
                            tint = Neutral400,
                            modifier = Modifier.size(48.dp)
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            "Aucune notification",
                            fontSize = 15.sp,
                            color = TextSecondary,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            "Vos alertes appara\u00eetront ici",
                            fontSize = 13.sp,
                            color = TextTertiary
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(notifications, key = { it.id }) { notification ->
                        if (notification.id !in dismissedIds) {
                            NotificationCard(
                                notification = notification,
                                onClick = {
                                    when (notification.type) {
                                        "consultation" -> {
                                            val consId = notification.id.removePrefix("cons_").removePrefix("cons_active_").removePrefix("cons_done_")
                                            if (consId.isNotBlank()) viewModel.setActiveConsultation(consId)
                                            onNavigate("chat")
                                        }
                                        "message" -> onNavigate("chat")
                                    }
                                },
                                onDismiss = { dismissedIds.add(notification.id) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NotificationCard(
    notification: AppNotification,
    onClick: () -> Unit,
    onDismiss: () -> Unit
) {
    var visible by remember { mutableStateOf(true) }

    val stripeColor = when (notification.type) {
        "consultation" -> PrimaryGreen
        "message" -> Color(0xFF3B82F6)
        "payment" -> Color(0xFFF59E0B)
        else -> Neutral400
    }

    val icon = when (notification.type) {
        "consultation" -> Icons.Default.MedicalServices
        "message" -> Icons.Default.Chat
        "payment" -> Icons.Default.Payment
        else -> Icons.Default.Info
    }

    AnimatedVisibility(
        visible = visible,
        enter = fadeIn() + slideInHorizontally(),
        exit = fadeOut()
    ) {
        Surface(
            onClick = onClick,
            shape = RoundedCornerShape(14.dp),
            color = Color.White,
            shadowElevation = 2.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.padding(14.dp),
                verticalAlignment = Alignment.Top
            ) {
                // Color stripe
                Box(
                    modifier = Modifier
                        .width(4.dp)
                        .height(48.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(stripeColor)
                )
                Spacer(modifier = Modifier.width(12.dp))

                // Icon
                Surface(
                    shape = CircleShape,
                    color = stripeColor.copy(alpha = 0.1f),
                    modifier = Modifier.size(36.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = icon,
                            contentDescription = null,
                            tint = stripeColor,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.width(12.dp))

                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = notification.title,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = TextPrimary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f)
                        )
                        if (!notification.isRead) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(PrimaryGreen)
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = notification.body,
                        fontSize = 13.sp,
                        color = TextSecondary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        lineHeight = 18.sp
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = formatNotifTime(notification.timestamp),
                        fontSize = 11.sp,
                        color = TextTertiary
                    )
                }

                Spacer(modifier = Modifier.width(8.dp))

                // Dismiss button
                IconButton(
                    onClick = { visible = false; onDismiss() },
                    modifier = Modifier.size(32.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Fermer",
                        tint = Neutral400,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }
    }
}

private fun formatNotifTime(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp
    return when {
        diff < 60000 -> "\u00c0 l\u2019instant"
        diff < 3600000 -> "${diff / 60000} min"
        diff < 86400000 -> "${diff / 3600000} h"
        else -> android.text.format.DateFormat.getMediumDateFormat(null)
            .format(java.util.Date(timestamp))
    }
}
