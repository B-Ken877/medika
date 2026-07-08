package com.example.ui.screens

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.LocalContext
import android.content.SharedPreferences
import android.content.Context


import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LocalHospital
import androidx.compose.material.icons.filled.MedicalServices
import androidx.compose.material.icons.filled.PhoneMissed
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.data.db.ConsultationEntity
import com.example.ui.AuthState
import com.example.ui.SanteViewModel
import com.example.ui.theme.*

// ═══════════════════════════════════════════════════════════════════════════════
// Data model
// ═══════════════════════════════════════════════════════════════════════════════

enum class NotifType(val key: String) {
    CONSULTATION_WAITING("consultation_waiting"),
    CONSULTATION_ACCEPTED("consultation_accepted"),
    CONSULTATION_COMPLETED("consultation_completed"),
    NEW_MESSAGE("new_message"),
    MISSED_CALL("missed_call"),
    PAYMENT_SUCCESS("payment_success"),
    PAYMENT_FAILED("payment_failed"),
    SYSTEM("system"),
}

data class AppNotification(
    val id: String,
    val type: NotifType,
    val title: String,
    val body: String,
    val timestamp: Long,
    val isRead: Boolean = false,
    val actionRoute: String? = null,
    val actionData: String? = null,
)

// ═══════════════════════════════════════════════════════════════════════════════
// Screen
// ═══════════════════════════════════════════════════════════════════════════════

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(
    viewModel: SanteViewModel,
    onNavigate: (String) -> Unit = {},
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val notifPrefs = remember { context.getSharedPreferences("medika_notifications", android.content.Context.MODE_PRIVATE) }
    // Collect state safely — no try-catch around composable calls
    val consultations by viewModel.allConsultations.collectAsStateWithLifecycle()
    val activeConsultationId by viewModel.activeConsultationId.collectAsStateWithLifecycle()
    val authState by viewModel.authState.collectAsStateWithLifecycle()

    // Build notifications safely in a plain function (not composable)
    // Filters by current user role so doctors and patients see only their own
    val notifications = remember(consultations, activeConsultationId, authState) {
        buildNotificationList(consultations, authState)
    }

    // Track dismissed (deleted) notification IDs — persisted so they survive navigation
    val dismissedIds = remember { mutableStateListOf<String>() }
    // Load persisted dismissed IDs on first composition
    val initiallyLoaded = remember { mutableStateOf(false) }
    if (!initiallyLoaded.value) {
        initiallyLoaded.value = true
        val saved = notifPrefs.getStringSet("dismissed_ids", emptySet()) ?: emptySet()
        dismissedIds.addAll(saved)
    }

    // Track explicitly read notification IDs — for "Tout lire" button
    val readIds = remember { mutableStateListOf<String>() }

    // Auto-persist dismissed IDs to SharedPreferences whenever they change
    LaunchedEffect(dismissedIds.toList()) {
        if (dismissedIds.isNotEmpty()) {
            notifPrefs.edit().putStringSet("dismissed_ids", dismissedIds.toSet()).apply()
        }
    }

    val unreadCount by remember(notifications, dismissedIds, readIds) {
        derivedStateOf {
            notifications.count {
                !it.isRead && it.id !in dismissedIds && it.id !in readIds
            }
        }
    }

    val visibleCount by remember(notifications, dismissedIds) {
        derivedStateOf {
            notifications.count { it.id !in dismissedIds }
        }
    }

    // Status bar inset height
    val statusBarInsets = WindowInsets.statusBars
    val density = LocalDensity.current
    val topInset = with(density) { statusBarInsets.getTop(density).toDp() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(SanteBackground)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // ── Top bar ──
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = topInset, start = 4.dp, end = 4.dp, bottom = 8.dp),
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

                if (unreadCount > 0) {
                    TextButton(
                        onClick = {
                            // Mark ALL visible unread notifications as read
                            notifications.forEach { notif ->
                                if (!notif.isRead && notif.id !in dismissedIds) {
                                    readIds.add(notif.id)
                                }
                            }
                        },
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)
                    ) {
                        Text(
                            text = "Tout lire",
                            fontSize = 12.sp,
                            color = PrimaryGreen,
                            fontWeight = FontWeight.Medium
                        )
                    }
                } else {
                    Spacer(modifier = Modifier.size(48.dp))
                }
            }

            Spacer(modifier = Modifier.height(2.dp))

            // ── Summary bar ──
            Surface(
                color = Color.White,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "$visibleCount",
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            color = PrimaryGreen
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = if (visibleCount <= 1) "notification" else "notifications",
                            fontSize = 13.sp,
                            color = TextSecondary
                        )
                    }
                    if (unreadCount > 0) {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = PrimaryGreen.copy(alpha = 0.1f)
                        ) {
                            Text(
                                text = "$unreadCount non lue${if (unreadCount > 1) "s" else ""}",
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                fontSize = 11.sp,
                                color = PrimaryGreen,
                                fontWeight = FontWeight.Medium
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // ── Notification list ──
            if (visibleCount == 0) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(bottom = 32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(horizontal = 40.dp)
                    ) {
                        Surface(
                            shape = CircleShape,
                            color = Neutral200.copy(alpha = 0.5f),
                            modifier = Modifier.size(80.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    imageVector = Icons.Default.Info,
                                    contentDescription = null,
                                    tint = Neutral400,
                                    modifier = Modifier.size(36.dp)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(20.dp))
                        Text(
                            "Aucune notification",
                            fontSize = 16.sp,
                            color = TextPrimary,
                            fontWeight = FontWeight.SemiBold,
                            textAlign = TextAlign.Center
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            "Vos alertes de consultation, messages\net mises a jour apparaitront ici.",
                            fontSize = 13.sp,
                            color = TextTertiary,
                            textAlign = TextAlign.Center,
                            lineHeight = 18.sp
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    items(
                        notifications.filter { it.id !in dismissedIds },
                        key = { it.id }
                    ) { notification ->
                        SwipeToDismissNotificationCard(
                            notification = notification,
                            isExplicitlyRead = notification.id in readIds,
                            onClick = {
                                // 1. Dismiss (delete) the notification from the list
                                dismissedIds.add(notification.id)
                                // 2. Navigate to the relevant screen
                                when (notification.type) {
                                    NotifType.CONSULTATION_WAITING,
                                    NotifType.CONSULTATION_ACCEPTED,
                                    NotifType.CONSULTATION_COMPLETED,
                                    NotifType.NEW_MESSAGE -> {
                                        val consId = notification.actionData
                                        if (!consId.isNullOrBlank()) {
                                            viewModel.setActiveConsultation(consId)
                                        }
                                        onNavigate("chat")
                                    }
                                    else -> {}
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

// ═══════════════════════════════════════════════════════════════════════════════
// Build notification list — crash-proof plain function, USER-SPECIFIC
// ═══════════════════════════════════════════════════════════════════════════════

private fun buildNotificationList(
    consultations: List<ConsultationEntity>,
    authState: AuthState
): List<AppNotification> {
    val list = mutableListOf<AppNotification>()

    // Determine current user and filter consultations accordingly
    val isDoctor = authState is AuthState.DoctorAuthenticated
    val isPatient = authState is AuthState.PatientAuthenticated

    val myUserId: String? = when (authState) {
        is AuthState.PatientAuthenticated -> authState.serverUser.id
        is AuthState.DoctorAuthenticated -> authState.serverUser.id
        else -> null
    }

    val myDoctorId: String? = when (authState) {
        is AuthState.DoctorAuthenticated -> authState.doctor.id
        else -> null
    }

    // Filter consultations: each user only sees their own
    val myConsultations = consultations.filter { c ->
        when {
            isPatient && !myUserId.isNullOrBlank() -> c.patientId == myUserId
            isDoctor && !myDoctorId.isNullOrBlank() -> c.doctorId == myDoctorId
            else -> false
        }
    }

    for (c in myConsultations) {
        try {
            val desc = c.description.ifBlank { "Consultation medicale" }
            val safeDesc = desc.take(60).ifBlank { "Sans description" }

            when (c.status) {
                "RECHERCHE_MEDECIN", "RECHERCHE" -> {
                    if (isPatient) {
                        list.add(
                            AppNotification(
                                id = "cons_wait_${c.id}",
                                type = NotifType.CONSULTATION_WAITING,
                                title = "Recherche de medecin",
                                body = "Votre consultation \"$safeDesc\" est en attente d'un medecin disponible.",
                                timestamp = c.timestamp,
                                isRead = false,
                                actionRoute = "chat",
                                actionData = c.id
                            )
                        )
                    }
                    // Doctors don't see "searching" notifications — those are for patients
                }
                "EN_COURS" -> {
                    if (isPatient) {
                        list.add(
                            AppNotification(
                                id = "cons_active_${c.id}",
                                type = NotifType.CONSULTATION_ACCEPTED,
                                title = "Medecin disponible",
                                body = "Un medecin a accepte votre consultation \"$safeDesc\". Vous pouvez commencer la discussion.",
                                timestamp = c.timestamp + 1000,
                                isRead = false,
                                actionRoute = "chat",
                                actionData = c.id
                            )
                        )
                    } else if (isDoctor) {
                        list.add(
                            AppNotification(
                                id = "cons_active_${c.id}",
                                type = NotifType.CONSULTATION_ACCEPTED,
                                title = "Nouvelle consultation",
                                body = "Consultation de ${c.patientName}: \"$safeDesc\". Commencez la discussion maintenant.",
                                timestamp = c.timestamp + 1000,
                                isRead = false,
                                actionRoute = "chat",
                                actionData = c.id
                            )
                        )
                    }
                }
                "TERMINEE" -> {
                    if (isPatient) {
                        list.add(
                            AppNotification(
                                id = "cons_done_${c.id}",
                                type = NotifType.CONSULTATION_COMPLETED,
                                title = "Consultation terminee",
                                body = "Votre consultation \"$safeDesc\" a ete clôturee avec succes. Consultez le resume dans l'historique.",
                                timestamp = c.timestamp + 2000,
                                isRead = true,
                                actionRoute = "chat",
                                actionData = c.id
                            )
                        )
                    } else if (isDoctor) {
                        list.add(
                            AppNotification(
                                id = "cons_done_${c.id}",
                                type = NotifType.CONSULTATION_COMPLETED,
                                title = "Consultation terminee",
                                body = "Consultation avec ${c.patientName} clôturee.",
                                timestamp = c.timestamp + 2000,
                                isRead = true,
                                actionRoute = "chat",
                                actionData = c.id
                            )
                        )
                    }
                }
            }
        } catch (_: Exception) {
            // Skip broken consultation notification
        }
    }

    // System notifications (shown to all users)
    if (isPatient) {
        list.add(
            AppNotification(
                id = "sys_welcome_v2",
                type = NotifType.SYSTEM,
                title = "Bienvenue sur Medika",
                body = "Votre plateforme de teleconsultation medicale en Haiti. Consultez un medecin en quelques clics.",
                timestamp = System.currentTimeMillis() - 172800000,
                isRead = true
            )
        )
        list.add(
            AppNotification(
                id = "sys_tip_v2",
                type = NotifType.SYSTEM,
                title = "Conseil",
                body = "Consultez rapidement un medecin disponible pour obtenir un avis medical professionnel.",
                timestamp = System.currentTimeMillis() - 86400000,
                isRead = true
            )
        )
    } else if (isDoctor) {
        list.add(
            AppNotification(
                id = "sys_doc_welcome",
                type = NotifType.SYSTEM,
                title = "Bienvenue, Docteur",
                body = "Vous recevrez des notifications pour chaque nouvelle consultation assignee.",
                timestamp = System.currentTimeMillis() - 172800000,
                isRead = true
            )
        )
    }

    return list.sortedByDescending { it.timestamp }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Swipe-to-dismiss card
// ═══════════════════════════════════════════════════════════════════════════════

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeToDismissNotificationCard(
    notification: AppNotification,
    isExplicitlyRead: Boolean,
    onClick: () -> Unit,
    onDismiss: () -> Unit
) {
    val dismissState = rememberSwipeToDismissBoxState(
        confirmValueChange = {
            if (it == SwipeToDismissBoxValue.EndToStart) {
                onDismiss()
                true
            } else {
                false
            }
        }
    )

    SwipeToDismissBox(
        state = dismissState,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            val color by animateFloatAsState(
                if (dismissState.targetValue == SwipeToDismissBoxValue.EndToStart) 1f else 0f,
                label = "swipe_bg"
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color(0xFFE53E3E).copy(alpha = color))
                    .padding(horizontal = 20.dp),
                contentAlignment = Alignment.CenterEnd
            ) {
                Icon(
                    imageVector = Icons.Default.DeleteSweep,
                    contentDescription = "Supprimer",
                    tint = Color.White,
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    ) {
        NotificationCard(
            notification = notification,
            isExplicitlyRead = isExplicitlyRead,
            onClick = onClick
        )
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Notification card
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
private fun NotificationCard(
    notification: AppNotification,
    isExplicitlyRead: Boolean,
    onClick: () -> Unit
) {
    val effectivelyRead = notification.isRead || isExplicitlyRead

    val (stripeColor, icon, iconBg) = when (notification.type) {
        NotifType.CONSULTATION_WAITING ->  Triple(Color(0xFFF59E0B), Icons.Default.LocalHospital, Color(0xFFF59E0B))
        NotifType.CONSULTATION_ACCEPTED -> Triple(PrimaryGreen, Icons.Default.MedicalServices, PrimaryGreen)
        NotifType.CONSULTATION_COMPLETED -> Triple(Color(0xFF3B82F6), Icons.Default.CheckCircle, Color(0xFF3B82F6))
        NotifType.NEW_MESSAGE ->           Triple(Color(0xFF8B5CF6), Icons.Default.ChatBubble, Color(0xFF8B5CF6))
        NotifType.MISSED_CALL ->           Triple(Color(0xFFEF4444), Icons.Default.PhoneMissed, Color(0xFFEF4444))
        NotifType.PAYMENT_SUCCESS ->       Triple(Color(0xFF10B981), Icons.Default.CreditCard, Color(0xFF10B981))
        NotifType.PAYMENT_FAILED ->        Triple(Color(0xFFEF4444), Icons.Default.CreditCard, Color(0xFFEF4444))
        NotifType.SYSTEM ->                Triple(Neutral400, Icons.Default.Info, Neutral400)
    }

    AnimatedVisibility(
        visible = true,
        enter = fadeIn() + slideInVertically(initialOffsetY = { it / 4 }),
        exit = fadeOut()
    ) {
        Surface(
            onClick = onClick,
            shape = RoundedCornerShape(14.dp),
            color = if (effectivelyRead) Color(0xFFF9FAFB) else Color.White,
            shadowElevation = if (effectivelyRead) 0.dp else 1.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.padding(14.dp),
                verticalAlignment = Alignment.Top
            ) {
                // Left color stripe
                Box(
                    modifier = Modifier
                        .width(3.dp)
                        .height(52.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(stripeColor)
                )

                Spacer(modifier = Modifier.width(12.dp))

                // Type icon
                Surface(
                    shape = CircleShape,
                    color = iconBg.copy(alpha = 0.1f),
                    modifier = Modifier.size(40.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = icon,
                            contentDescription = null,
                            tint = stripeColor,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.width(12.dp))

                // Content
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = notification.title,
                            fontSize = 14.sp,
                            fontWeight = if (effectivelyRead) FontWeight.Medium else FontWeight.SemiBold,
                            color = TextPrimary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f)
                        )
                        if (!effectivelyRead) {
                            Spacer(modifier = Modifier.width(8.dp))
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
                        color = if (effectivelyRead) TextTertiary else TextSecondary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        lineHeight = 18.sp
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = formatNotifTime(notification.timestamp),
                        fontSize = 11.sp,
                        color = TextTertiary
                    )
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Time formatter
// ═══════════════════════════════════════════════════════════════════════════════

private fun formatNotifTime(timestamp: Long): String {
    return try {
        val now = System.currentTimeMillis()
        val diff = now - timestamp
        when {
            diff < 0 -> "A l'instant"
            diff < 60_000L -> "A l'instant"
            diff < 3_600_000L -> "${diff / 60_000L} min"
            diff < 86_400_000L -> "${diff / 3_600_000L} h"
            diff < 172_800_000L -> "Hier"
            else -> {
                val days = diff / 86_400_000L
                if (days < 7) "Il y a $days jours" else "Il y a ${(days / 7)} sem."
            }
        }
    } catch (_: Exception) {
        ""
    }
}