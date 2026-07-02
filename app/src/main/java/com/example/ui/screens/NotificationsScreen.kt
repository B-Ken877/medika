package com.example.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Message
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Payment
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ui.theme.*

// ─── Data Model ────────────────────────────────────────────────────────

enum class NotificationType {
    CONSULTATION, MESSAGE, SYSTEM, PAYMENT
}

data class SampleNotification(
    val id: Int,
    val type: NotificationType,
    val title: String,
    val body: String,
    val timestamp: String
)

// ─── Color Mapping ─────────────────────────────────────────────────────

private val NotificationType.stripeColor: Color
    get() = when (this) {
        NotificationType.CONSULTATION -> PrimaryGreen
        NotificationType.MESSAGE -> Color(0xFF3B82F6)
        NotificationType.SYSTEM -> Color(0xFF9E9E9E)
        NotificationType.PAYMENT -> Color(0xFFF59E0B)
    }

// ─── Sample Data ───────────────────────────────────────────────────────

private val sampleNotifications = listOf(
    SampleNotification(
        id = 1,
        type = NotificationType.CONSULTATION,
        title = "Consultation confirmée",
        body = "Votre consultation avec le Dr. Mbeki est confirmée pour le 15 juin 2025 à 10h00. Veuillez vous présenter 10 minutes avant l'heure prévue.",
        timestamp = "Il y a 5 min"
    ),
    SampleNotification(
        id = 2,
        type = NotificationType.MESSAGE,
        title = "Nouveau message du Dr. Koffi",
        body = "Bonjour, les résultats de vos analyses sanguines sont disponibles. Vous pouvez les consulter dans votre espace patient.",
        timestamp = "Il y a 30 min"
    ),
    SampleNotification(
        id = 3,
        type = NotificationType.PAYMENT,
        title = "Paiement reçu",
        body = "Votre paiement de 15 000 FCFA pour la consultation du 12 juin a été reçu avec succès. Merci pour votre confiance.",
        timestamp = "Il y a 2h"
    ),
    SampleNotification(
        id = 4,
        type = NotificationType.SYSTEM,
        title = "Mise à jour de l'application",
        body = "Une nouvelle version de Medika est disponible. Veuillez mettre à jour pour bénéficier des dernières améliorations et corrections.",
        timestamp = "Il y a 5h"
    ),
    SampleNotification(
        id = 5,
        type = NotificationType.CONSULTATION,
        title = "Rappel de rendez-vous",
        body = "N'oubliez pas votre consultation demain à 14h00 avec le Dr. Diallo. Pensez à préparer vos documents médicaux.",
        timestamp = "Hier"
    ),
    SampleNotification(
        id = 6,
        type = NotificationType.MESSAGE,
        title = "Ordonnance disponible",
        body = "Le Dr. Traoré a rédigé une nouvelle ordonnance suite à votre dernière visite. Consultez-la et présentez-la à votre pharmacien.",
        timestamp = "Hier"
    ),
    SampleNotification(
        id = 7,
        type = NotificationType.PAYMENT,
        title = "Facture disponible",
        body = "Votre facture de 8 500 FCFA pour les examens de laboratoire est prête. Vous pouvez la télécharger depuis votre espace.",
        timestamp = "Il y a 3 jours"
    ),
    SampleNotification(
        id = 8,
        type = NotificationType.SYSTEM,
        title = "Bienvenue sur Medika",
        body = "Merci d'avoir rejoint Medika. Vous pouvez maintenant prendre des rendez-vous, consulter vos résultats et communiquer avec vos médecins.",
        timestamp = "Il y a 7 jours"
    )
)

// ─── Main Screen ───────────────────────────────────────────────────────

@Composable
fun NotificationsScreen(
    onBack: () -> Unit
) {
    val notifications = remember { mutableStateListOf<SampleNotification>() }
    val dismissedIds = remember { mutableStateListOf<Int>() }

    LaunchedEffect(Unit) {
        notifications.addAll(sampleNotifications)
    }

    val visibleNotifications = notifications.filter { it.id !in dismissedIds }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SanteBackground)
    ) {
        // ── Top Bar ────────────────────────────────────────────────
        Surface(
            color = PrimaryGreen,
            shadowElevation = 4.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 4.dp, top = 8.dp, bottom = 8.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onBack) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Retour",
                        tint = Color.White
                    )
                }
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Notifications",
                    color = Color.White,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }

        // ── Content ────────────────────────────────────────────────
        if (visibleNotifications.isEmpty()) {
            EmptyNotificationState()
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                visibleNotifications.forEachIndexed { index, notification ->
                    DismissableNotificationCard(
                        notification = notification,
                        index = index,
                        onDismiss = { dismissedIds.add(it) }
                    )
                }

                // Bottom spacing for scroll
                Spacer(modifier = Modifier.height(16.dp))
            }
        }
    }
}

// ─── Empty State ───────────────────────────────────────────────────────

@Composable
private fun EmptyNotificationState() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(vertical = 100.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(88.dp)
                .background(Color(0xFFE0E0E0), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.Notifications,
                contentDescription = null,
                modifier = Modifier.size(42.dp),
                tint = Color(0xFF9E9E9E)
            )
        }
        Spacer(modifier = Modifier.height(20.dp))
        Text(
            text = "Aucune notification",
            style = MaterialTheme.typography.titleMedium,
            color = TextPrimary,
            fontWeight = FontWeight.SemiBold
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Vos nouvelles notifications\napparaîtront ici",
            style = MaterialTheme.typography.bodyMedium,
            color = TextSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 48.dp)
        )
    }
}

// ─── Notification Card with Dismiss ────────────────────────────────────

@Composable
private fun DismissableNotificationCard(
    notification: SampleNotification,
    index: Int,
    onDismiss: (Int) -> Unit
) {
    var visible by remember { mutableStateOf(true) }

    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(
            animationSpec = tween(350, delayMillis = index * 60)
        ) + slideInVertically(
            initialOffsetY = { 24 },
            animationSpec = tween(350, delayMillis = index * 60)
        ),
        exit = fadeOut(animationSpec = tween(250)) + slideOutVertically(
            targetOffsetY = { -16 },
            animationSpec = tween(250)
        )
    ) {
        NotificationCard(
            notification = notification,
            onClick = {
                visible = false
                onDismiss(notification.id)
            }
        )
    }
}

// ─── Notification Card ─────────────────────────────────────────────────

@Composable
private fun NotificationCard(
    notification: SampleNotification,
    onClick: () -> Unit
) {
    val stripeColor = notification.type.stripeColor

    ElevatedCard(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.elevatedCardColors(
            containerColor = Color.White
        ),
        elevation = CardDefaults.elevatedCardElevation(
            defaultElevation = 2.dp
        )
    ) {
        Box(
            modifier = Modifier.fillMaxWidth()
        ) {
            // Left color stripe
            Box(
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .fillMaxHeight()
                    .width(4.dp)
                    .background(stripeColor, RoundedCornerShape(topStart = 12.dp, bottomStart = 12.dp))
            )

            // Card content
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 14.dp, end = 14.dp, top = 14.dp, bottom = 14.dp)
            ) {
                // Type icon
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .background(stripeColor.copy(alpha = 0.1f), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = when (notification.type) {
                            NotificationType.CONSULTATION -> Icons.Default.CheckCircle
                            NotificationType.MESSAGE -> Icons.Default.Message
                            NotificationType.SYSTEM -> Icons.Default.Info
                            NotificationType.PAYMENT -> Icons.Default.Payment
                        },
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                        tint = stripeColor
                    )
                }

                Spacer(modifier = Modifier.width(12.dp))

                // Text content
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .height(56.dp),
                    verticalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.Top
                    ) {
                        Text(
                            text = notification.title,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = notification.timestamp,
                            fontSize = 11.sp,
                            color = Color(0xFF9E9E9E),
                            fontWeight = FontWeight.Normal
                        )
                    }

                    Text(
                        text = notification.body,
                        fontSize = 13.sp,
                        color = TextSecondary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        lineHeight = 18.sp
                    )
                }
            }
        }
    }
}
