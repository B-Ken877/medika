package com.example.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.db.ConsultationEntity
import com.example.data.db.DoctorEntity
import com.example.data.db.MessageEntity
import com.example.ui.theme.*
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import androidx.compose.material.icons.filled.PlayArrow

// ═══════════════════════════════════════════════════════════════════════
// 1. AnimatedButton — Primary action button with refined press animation
// ═══════════════════════════════════════════════════════════════════════

@Composable
fun AnimatedButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()

    val targetScale = when {
        !enabled -> 1f
        isPressed -> 0.96f
        else -> 1f
    }

    Surface(
        onClick = if (enabled) onClick else {{}},
        modifier = modifier
            .height(52.dp)
            .graphicsLayer {
                scaleX = targetScale
                scaleY = targetScale
            }
            .then(
                if (!enabled) Modifier.alpha(0.5f) else Modifier
            ),
        enabled = enabled,
        shape = RoundedCornerShape(14.dp),
        color = PrimaryGreen,
        contentColor = Color.White,
        shadowElevation = if (enabled) 2.dp else 0.dp,
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(
                text = text,
                style = MaterialTheme.typography.labelLarge,
                color = Color.White,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
            )
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// 2. DepthCard — Clean white Surface card with elevation and border
// ═══════════════════════════════════════════════════════════════════════

@Composable
fun DepthCard(
    modifier: Modifier = Modifier,
    elevationLevel: Int = 1,
    content: @Composable ColumnScope.() -> Unit,
) {
    require(elevationLevel in 0..3) { "elevationLevel must be 0, 1, 2, or 3" }

    val elevationDp = when (elevationLevel) {
        0 -> 0.dp
        1 -> 2.dp
        2 -> 6.dp
        else -> 12.dp
    }

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = Color.White,
        shadowElevation = elevationDp,
        tonalElevation = 0.dp,
        border = BorderStroke(
            width = 0.5.dp,
            color = Neutral200,
        ),
    ) {
        Column(content = content)
    }
}

// ═══════════════════════════════════════════════════════════════════════
// 3. DoctorCard — Professional doctor listing card
// ═══════════════════════════════════════════════════════════════════════

@Composable
fun DoctorCard(
    doctor: DoctorEntity,
    onClick: () -> Unit,
) {
    val initials = remember(doctor.name) {
        doctor.name
            .split(" ")
            .filter { it.isNotBlank() }
            .take(2)
            .joinToString("") { it.first().uppercase() }
    }

    val ratingValue = doctor.rating.coerceIn(0.0, 5.0)
    val fullStars = ratingValue.toInt()
    val hasHalf = (ratingValue - fullStars) >= 0.3

    DepthCard(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // ── Avatar: green circle with initials ──
            Surface(
                modifier = Modifier.size(48.dp),
                shape = CircleShape,
                color = PrimaryGreen,
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = initials,
                        color = Color.White,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                }
            }

            Spacer(modifier = Modifier.width(14.dp))

            // ── Info: name, specialty, rating ──
            Column(
                modifier = Modifier.weight(1f),
            ) {
                Text(
                    text = doctor.name,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )

                Spacer(modifier = Modifier.height(2.dp))

                Text(
                    text = doctor.specialty,
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )

                Spacer(modifier = Modifier.height(6.dp))

                // Star rating row
                Row(verticalAlignment = Alignment.CenterVertically) {
                    repeat(5) { index ->
                        Icon(
                            imageVector = if (index < fullStars || (index == fullStars && hasHalf)) {
                                Icons.Filled.Star
                            } else {
                                Icons.Outlined.Star
                            },
                            contentDescription = null,
                            tint = if (index < fullStars) SanteWarning
                                   else if (index == fullStars && hasHalf) SanteWarning.copy(alpha = 0.5f)
                                   else Neutral300,
                            modifier = Modifier.size(13.dp),
                        )
                    }

                    Spacer(modifier = Modifier.width(4.dp))

                    Text(
                        text = String.format(Locale.getDefault(), "%.1f", ratingValue),
                        style = MaterialTheme.typography.labelSmall,
                        color = TextSecondary,
                        fontWeight = FontWeight.Medium,
                    )
                }

                // Online badge
                if (doctor.isAvailable) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .background(SanteSuccess, CircleShape)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "Disponible",
                            style = MaterialTheme.typography.labelSmall,
                            color = SanteSuccess,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.width(12.dp))

            // ── Action button ──
            Surface(
                onClick = onClick,
                shape = RoundedCornerShape(10.dp),
                color = PrimaryGreen,
                contentColor = Color.White,
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)
                ) {
                    Text(
                        text = "Consulter",
                        style = MaterialTheme.typography.labelMedium,
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// 4. ConsultationCard — Consultation item with status indicator
// ═══════════════════════════════════════════════════════════════════════

@Composable
fun ConsultationCard(
    consultation: ConsultationEntity,
    onClick: () -> Unit,
) {
    // Map status to visual properties
    val (statusColor, statusLabel) = when (consultation.status) {
        "in_progress", "active", "EN_COURS" -> SanteSuccess to "En cours"
        "pending", "RECHERCHE", "searching" -> SanteWarning to "Recherche"
        "completed", "resolved", "TERMINE" -> Neutral400 to "Terminé"
        "cancelled" -> SanteDanger to "Annulé"
        else -> Neutral400 to consultation.status
    }

    val formattedTime = remember(consultation.timestamp) {
        try {
            val sdf = SimpleDateFormat("dd MMM, HH:mm", Locale.getDefault())
            sdf.format(Date(consultation.timestamp))
        } catch (_: Exception) {
            ""
        }
    }

    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = Color.White,
        shadowElevation = 1.dp,
        border = BorderStroke(0.5.dp, Neutral200),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 4.dp, top = 14.dp, end = 14.dp, bottom = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // ── Status dot ──
            Box(
                modifier = Modifier
                    .padding(start = 10.dp)
                    .size(10.dp)
                    .background(statusColor, CircleShape)
            )

            Spacer(modifier = Modifier.width(14.dp))

            // ── Info column ──
            Column(
                modifier = Modifier.weight(1f),
            ) {
                Text(
                    text = consultation.patientName,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )

                if (consultation.specialtyNeeded.isNotBlank()) {
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = consultation.specialtyNeeded,
                        style = MaterialTheme.typography.bodySmall,
                        color = TextSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = formattedTime,
                    style = MaterialTheme.typography.labelSmall,
                    color = TextTertiary,
                )
            }

            // ── Status badge pill ──
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = statusColor.copy(alpha = 0.1f),
            ) {
                Text(
                    text = statusLabel,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = statusColor,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// 5. StatCard — Clean statistic card with icon, value, and label
// ═══════════════════════════════════════════════════════════════════════

@Composable
fun StatCard(
    modifier: Modifier = Modifier,
    title: String,
    value: String,
    icon: ImageVector,
    tint: Color = Green100,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = Color.White,
        shadowElevation = 2.dp,
        border = BorderStroke(0.5.dp, Neutral200),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Icon in a light-colored circle
            Box(
                modifier = Modifier
                    .size(24.dp)
                    .background(tint, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = title,
                    tint = PrimaryGreen,
                    modifier = Modifier.size(14.dp),
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Large bold value
            Text(
                text = value,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
            )

            Spacer(modifier = Modifier.height(4.dp))

            // Small gray title
            Text(
                text = title,
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
            )
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// 6. ShimmerBox — Smooth animated loading placeholder
// ═══════════════════════════════════════════════════════════════════════

@Composable
fun ShimmerBox(
    modifier: Modifier = Modifier,
) {
    val infiniteTransition = rememberInfiniteTransition(label = "shimmer")

    val shimmerOffset by infiniteTransition.animateFloat(
        initialValue = -400f,
        targetValue = 400f,
        animationSpec = infiniteRepeatable(
            animation = tween(
                durationMillis = 1400,
                easing = androidx.compose.animation.core.FastOutSlowInEasing,
            ),
            repeatMode = RepeatMode.Restart,
        ),
        label = "shimmer_offset",
    )

    val brush = Brush.horizontalGradient(
        colors = listOf(
            Neutral100,
            Neutral50,
            Neutral100,
        ),
        startX = shimmerOffset,
        endX = shimmerOffset + 400f,
    )

    Box(
        modifier = modifier
            .background(brush, RoundedCornerShape(16.dp)),
    )
}

// ═══════════════════════════════════════════════════════════════════════
// 7. MessageBubble — Chat message bubble with directional tail
// ═══════════════════════════════════════════════════════════════════════

@Composable
fun MessageBubble(
    message: MessageEntity,
    isOwn: Boolean,
    onPlayVoice: ((MessageEntity) -> Unit)? = null,
) {
    val bubbleColor = if (isOwn) PrimaryGreen else Neutral50
    val textColor = if (isOwn) Color.White else TextPrimary
    val timeColor = if (isOwn) Color.White.copy(alpha = 0.75f) else TextTertiary

    val formattedTime = remember(message.timestamp) {
        try {
            SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(message.timestamp))
        } catch (_: Exception) {
            ""
        }
    }

    val cornerRadius = 12.dp

    val bubbleShape = if (isOwn) {
        RoundedCornerShape(
            topStart = cornerRadius,
            topEnd = cornerRadius,
            bottomStart = cornerRadius,
            bottomEnd = 2.dp,
        )
    } else {
        RoundedCornerShape(
            topStart = cornerRadius,
            topEnd = cornerRadius,
            bottomStart = 2.dp,
            bottomEnd = cornerRadius,
        )
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 2.dp),
        horizontalAlignment = if (isOwn) Alignment.End else Alignment.Start,
    ) {
        // Sender name for non-own messages
        if (!isOwn && message.senderName.isNotBlank()) {
            Text(
                text = message.senderName,
                style = MaterialTheme.typography.labelSmall,
                color = PrimaryGreen,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(bottom = 2.dp, start = 4.dp),
            )
        }

        when (message.messageType) {
            "image" -> {
                Surface(
                    shape = bubbleShape,
                    color = bubbleColor,
                    shadowElevation = 0.5.dp,
                    tonalElevation = 0.dp,
                    modifier = Modifier.widthIn(max = 280.dp),
                ) {
                    Column(modifier = Modifier.padding(4.dp)) {
                        val displayPath = message.localFilePath ?: message.fileUrl
                        if (displayPath != null) {
                            val isLocal = message.localFilePath != null
                            if (isLocal) {
                                val bitmap = remember(displayPath) {
                                    try {
                                        val bmp = android.graphics.BitmapFactory.decodeFile(displayPath)
                                        bmp?.asImageBitmap()
                                    } catch (_: Exception) { null }
                                }
                                if (bitmap != null) {
                                    androidx.compose.foundation.Image(
                                        bitmap = bitmap,
                                        contentDescription = "Image",
                                        contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(10.dp))
                                    )
                                } else {
                                    Text(text = "[Image]", color = textColor, modifier = Modifier.padding(12.dp))
                                }
                            } else {
                                Text(text = "[Image]", color = textColor, modifier = Modifier.padding(12.dp))
                            }
                        } else {
                            Text(
                                text = message.text.ifBlank { "[Image]" },
                                color = textColor,
                                modifier = Modifier.padding(12.dp)
                            )
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp),
                            horizontalArrangement = Arrangement.End,
                        ) {
                            Text(
                                text = formattedTime,
                                style = MaterialTheme.typography.labelSmall,
                                color = timeColor,
                                fontSize = 10.sp,
                            )
                        }
                    }
                }
            }

            "voice" -> {
                Surface(
                    shape = bubbleShape,
                    color = bubbleColor,
                    shadowElevation = 0.5.dp,
                    tonalElevation = 0.dp,
                    modifier = Modifier.widthIn(max = 280.dp),
                ) {
                    Row(
                        modifier = Modifier
                            .clickable { onPlayVoice?.invoke(message) }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = Icons.Default.PlayArrow,
                            contentDescription = "Lire",
                            tint = textColor,
                            modifier = Modifier.size(28.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(2.dp),
                            modifier = Modifier.weight(1f),
                        ) {
                            repeat(12) { i ->
                                val h = when {
                                    i % 3 == 0 -> 14.dp
                                    i % 3 == 1 -> 8.dp
                                    else -> 4.dp
                                }
                                Box(
                                    modifier = Modifier
                                        .width(3.dp)
                                        .height(h)
                                        .background(textColor.copy(alpha = 0.6f), RoundedCornerShape(1.dp))
                                )
                            }
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = if ((message.duration ?: 0) > 0)
                                String.format("%d:%02d", (message.duration ?: 0) / 60, (message.duration ?: 0) % 60)
                            else "0:00",
                            style = MaterialTheme.typography.labelSmall,
                            color = timeColor,
                            fontSize = 11.sp,
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                    }
                }
            }

            else -> {
                // Text message bubble (default)
                Surface(
                    shape = bubbleShape,
                    color = bubbleColor,
                    shadowElevation = 0.5.dp,
                    tonalElevation = 0.dp,
                    modifier = Modifier.widthIn(max = 280.dp),
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        if (message.text.isNotBlank()) {
                            Text(
                                text = message.text,
                                style = MaterialTheme.typography.bodyMedium,
                                color = textColor,
                                lineHeight = 20.sp,
                            )
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                        ) {
                            Text(
                                text = formattedTime,
                                style = MaterialTheme.typography.labelSmall,
                                color = timeColor,
                                fontSize = 10.sp,
                            )
                        }
                    }
                }
            }
        }
    }
}
