package com.example.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.LinearEasing
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import coil.compose.AsyncImage
import com.example.data.db.ConsultationEntity
import com.example.data.db.DoctorEntity
import com.example.data.db.MessageEntity
import android.media.MediaPlayer
import androidx.compose.foundation.border
import com.example.ui.theme.*
import androidx.compose.ui.layout.ContentScale
import java.text.SimpleDateFormat
import java.util.Date
import kotlin.math.sin
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import java.util.Locale

// ---------------------------------------------------------------------------
// 1. DepthCard — Surface-based card with elevation and optional green border
// ---------------------------------------------------------------------------

@Composable
fun DepthCard(
    modifier: Modifier = Modifier,
    elevationLevel: Int = 1,
    greenTint: Boolean = true,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    require(elevationLevel in 0..3) { "elevationLevel must be 0, 1, 2, or 3" }

    val elevationDp = when (elevationLevel) {
        0 -> 0.dp
        1 -> 2.dp
        2 -> 6.dp
        else -> 12.dp
    }

    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()

    val scale = if (onClick != null && isPressed) 0.98f else 1f

    Surface(
        modifier = modifier
            .then(
                if (onClick != null) {
                    Modifier
                        .graphicsLayer { scaleX = scale; scaleY = scale }
                        .then(
                            Modifier.clickable(
                                interactionSource = interactionSource,
                                indication = null,
                            ) { onClick() }
                        )
                } else {
                    Modifier
                }
            ),
        shadowElevation = elevationDp,
        shape = RoundedCornerShape(16.dp),
        color = Color.White,
        border = if (greenTint) BorderStroke(1.dp, Green100) else null,
    ) {
        Column(content = content)
    }
}

// ---------------------------------------------------------------------------
// 2. StatCard — icon + value + title in a DepthCard
// ---------------------------------------------------------------------------

@Composable
fun StatCard(
    title: String,
    value: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    tint: Color = Green100,
) {
    DepthCard(modifier = modifier) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(tint),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = title,
                    tint = PrimaryGreen,
                    modifier = Modifier.size(24.dp),
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = value,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// 3. ShimmerBox — animated gradient placeholder
// ---------------------------------------------------------------------------

@Composable
fun ShimmerBox(
    modifier: Modifier = Modifier,
) {
    val infiniteTransition = rememberInfiniteTransition(label = "shimmer")

    val offset by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1200f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1200, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "shimmer_offset",
    )

    val brush = Brush.horizontalGradient(
        colors = listOf(Green50, Color.White, Green50),
        startX = offset - 400f,
        endX = offset,
    )

    Box(
        modifier = modifier
            .background(brush, RoundedCornerShape(16.dp)),
    )
}

// ---------------------------------------------------------------------------
// 4. PulsingBadge — green circle with count and pulsing scale
// ---------------------------------------------------------------------------

@Composable
fun PulsingBadge(
    count: Int,
    modifier: Modifier = Modifier,
) {
    if (count <= 0) return

    val infiniteTransition = rememberInfiniteTransition(label = "badge_pulse")
    val scale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.15f,
        animationSpec = infiniteRepeatable(
            animation = tween(600),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "badge_scale",
    )

    Box(
        modifier = modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .size(20.dp)
            .background(PrimaryGreen, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = if (count > 99) "99+" else count.toString(),
            color = Color.White,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

// ---------------------------------------------------------------------------
// 5. AnimatedButton — button with press-scale and optional loading
// ---------------------------------------------------------------------------

@Composable
fun AnimatedButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    isLoading: Boolean = false,
    enabled: Boolean = true,
    containerColor: Color = PrimaryGreen,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()

    val scale = if (isPressed) 0.96f else 1f

    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(containerColor = containerColor),
        shape = RoundedCornerShape(12.dp),
        modifier = modifier
            .graphicsLayer { scaleX = scale; scaleY = scale },
        interactionSource = interactionSource,
    ) {
        if (isLoading) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                color = Color.White,
                strokeWidth = 2.dp,
            )
            Spacer(modifier = Modifier.width(8.dp))
        }
        Text(
            text = text,
            color = Color.White,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

// ---------------------------------------------------------------------------
// 6. DoctorCard — doctor listing with avatar, info, and rating
// ---------------------------------------------------------------------------

@Composable
fun DoctorCard(
    doctor: DoctorEntity,
    onClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    DepthCard(
        modifier = modifier,
        onClick = onClick,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Avatar
            Surface(
                modifier = Modifier.size(48.dp),
                shape = CircleShape,
                border = BorderStroke(2.dp, Green200),
            ) {
                AsyncImage(
                    model = doctor.avatarUrl,
                    contentDescription = doctor.name,
                    modifier = Modifier
                        .size(48.dp)
                        .clip(CircleShape),
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            // Info
            Column(modifier = Modifier.weight(1f)) {
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
                if (!doctor.hospital.isNullOrBlank()) {
                    Text(
                        text = doctor.hospital,
                        style = MaterialTheme.typography.bodySmall,
                        color = TextSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            // Rating
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.Star,
                        contentDescription = "Rating",
                        tint = SanteWarning,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = doctor.rating?.toString() ?: "N/A",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary,
                    )
                }
                if (doctor.isAvailable == true) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Available",
                        style = MaterialTheme.typography.labelSmall,
                        color = SanteSuccess,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 7. ConsultationCard — consultation item with status and urgency
// ---------------------------------------------------------------------------

@Composable
fun ConsultationCard(
    consultation: ConsultationEntity,
    onClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    doctorName: String? = null,
) {
    val statusColor = when (consultation.status) {
        "completed", "resolved" -> SanteSuccess
        "in_progress", "active" -> PrimaryGreen
        "cancelled" -> SanteDanger
        "pending" -> SanteWarning
        else -> TextSecondary
    }

    val urgencyColor = when (consultation.urgencyLevel) {
        "high", "urgent" -> SanteDanger
        "medium" -> SanteWarning
        else -> SanteSuccess
    }

    val formattedTime = remember(consultation.timestamp) {
        if (consultation.timestamp != null) {
            try {
                val sdf = SimpleDateFormat("MMM dd, HH:mm", Locale.getDefault())
                sdf.format(Date(consultation.timestamp))
            } catch (_: Exception) {
                ""
            }
        } else {
            ""
        }
    }

    DepthCard(
        modifier = modifier,
        onClick = onClick,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
        ) {
            // Top row: status + urgency + time
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = statusColor.copy(alpha = 0.12f),
                ) {
                    Text(
                        text = consultation.status?.replace("_", " ")
                            ?.replaceFirstChar { it.uppercase() } ?: "Unknown",
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = statusColor,
                        fontWeight = FontWeight.SemiBold,
                    )
                }

                Text(
                    text = formattedTime,
                    style = MaterialTheme.typography.labelSmall,
                    color = TextSecondary,
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Patient name / description
            Text(
                text = consultation.patientName,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )

            if (!consultation.description.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = consultation.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            // Bottom row: specialty + urgency + doctor
            Spacer(modifier = Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!consultation.specialtyNeeded.isNullOrBlank()) {
                    Text(
                        text = consultation.specialtyNeeded,
                        style = MaterialTheme.typography.labelSmall,
                        color = TextSecondary,
                    )
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = urgencyColor.copy(alpha = 0.12f),
                    ) {
                        Text(
                            text = consultation.urgencyLevel?.replaceFirstChar { it.uppercase() }
                                ?: "Low",
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            style = MaterialTheme.typography.labelSmall,
                            color = urgencyColor,
                            fontWeight = FontWeight.Medium,
                        )
                    }

                    if (doctorName != null) {
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "• $doctorName",
                            style = MaterialTheme.typography.labelSmall,
                            color = TextSecondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 8. MessageBubble — chat message bubble (WhatsApp-style with tails)
// ---------------------------------------------------------------------------

@Composable
fun MessageBubble(
    message: MessageEntity,
    isFromMe: Boolean,
    modifier: Modifier = Modifier,
    onRetry: ((Int) -> Unit)? = null,
) {
    // WhatsApp-style bubble colors:
    //  - Outgoing (isFromMe): light green (#DCF8C6 in WhatsApp, we use a slightly
    //    different green to match the Medika palette)
    //  - Incoming: white
    val bubbleColor = if (isFromMe) Color(0xFFE0F5E0) else Color.White
    val textColor = if (isFromMe) TextPrimary else TextPrimary
    val timeColor = if (isFromMe) TextSecondary.copy(alpha = 0.8f) else TextSecondary

    val formattedTime = remember(message.timestamp) {
        try { SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(message.timestamp)) }
        catch (_: Exception) { "" }
    }

    val sendStatus = message.sendStatus
    val isFailed = isFromMe && sendStatus == "failed"
    val isSending = isFromMe && sendStatus == "sending"

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 1.dp),
        horizontalAlignment = if (isFromMe) Alignment.End else Alignment.Start,
    ) {
        // The bubble itself — WhatsApp-style rounded rectangle with a small tail
        // on the side. We use a different corner shape for the tail corner.
        val bubbleShape = if (isFromMe) {
            RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomStart = 16.dp, bottomEnd = 4.dp)
        } else {
            RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomStart = 4.dp, bottomEnd = 16.dp)
        }
        Surface(
            shape = bubbleShape,
            color = bubbleColor,
            shadowElevation = 0.5.dp,
            tonalElevation = 0.dp,
            modifier = Modifier.widthIn(max = 280.dp)
        ) {
            when (message.messageType) {
                "voice" -> VoiceMessageBubble(message, isFromMe, bubbleColor, textColor, timeColor, formattedTime, onRetry)
                "image" -> ImageMessageBubble(message, isFromMe, bubbleColor, textColor, timeColor, formattedTime, onRetry)
                "video" -> VideoMessageBubble(message, isFromMe, bubbleColor, textColor, timeColor, formattedTime, onRetry)
                else -> TextMessageBubble(message, isFromMe, bubbleColor, textColor, timeColor, formattedTime)
            }
        }
    }
}

/** Small status indicator (clock for sending, single tick for sent, error for failed). */
@Composable
private fun MessageStatusIndicator(
    status: String?,
    isFromMe: Boolean,
    timeColor: Color,
    onRetry: ((Int) -> Unit)? = null,
    messageId: Int = 0
) {
    if (!isFromMe || status == null) return
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        when (status) {
            "sending" -> Icon(
                Icons.Default.AccessTime,
                contentDescription = "Envoi",
                tint = timeColor,
                modifier = Modifier.size(12.dp)
            )
            "sent" -> Icon(
                Icons.Default.Check,
                contentDescription = "Envoye",
                tint = timeColor,
                modifier = Modifier.size(14.dp)
            )
            "failed" -> {
                Icon(
                    Icons.Default.Error,
                    contentDescription = "Echec",
                    tint = Color(0xFFE53935),
                    modifier = Modifier.size(13.dp)
                )
                if (onRetry != null) {
                    Spacer(Modifier.width(4.dp))
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = Color(0xFFE53935),
                        onClick = { onRetry(messageId) }
                    ) {
                        Text(
                            "Reessayer",
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 1.dp),
                            fontSize = 10.sp,
                            color = Color.White,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TextMessageBubble(
    message: MessageEntity, isFromMe: Boolean, bubbleColor: Color, textColor: Color, timeColor: Color, formattedTime: String,
) {
    Column(
        modifier = Modifier.padding(start = 10.dp, end = 10.dp, top = 6.dp, bottom = 5.dp)
    ) {
        Text(
            message.text,
            style = MaterialTheme.typography.bodyMedium,
            color = textColor,
            fontSize = 14.sp,
            lineHeight = 18.sp
        )
        Spacer(Modifier.height(2.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (formattedTime.isNotEmpty()) {
                Text(formattedTime, fontSize = 10.sp, color = timeColor)
            }
            Spacer(Modifier.width(4.dp))
            MessageStatusIndicator(
                status = message.sendStatus,
                isFromMe = isFromMe,
                timeColor = timeColor
            )
        }
    }
}

@Composable
private fun VoiceMessageBubble(
    message: MessageEntity, isFromMe: Boolean, bubbleColor: Color, textColor: Color, timeColor: Color, formattedTime: String,
    onRetry: ((Int) -> Unit)? = null,
) {
    var isPlaying by remember { mutableStateOf(false) }
    var isDownloading by remember { mutableStateOf(false) }
    val durationSecs = message.duration ?: 0
    val formattedDuration = String.format("%02d:%02d", durationSecs / 60, durationSecs % 60)
    val mediaPlayer = remember { mutableStateOf<MediaPlayer?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current

    // Local-first: prefer the cached local file, fall back to the server URL.
    val localFile = remember(message.localFilePath) {
        message.localFilePath?.let { java.io.File(it).takeIf { f -> f.exists() && f.length() > 0 } }
    }
    val remoteUrl = message.fileUrl?.let { "http://167.86.124.101:3000$it" }
    val sendStatus = message.sendStatus
    val isFailed = isFromMe && sendStatus == "failed"
    val isSending = isFromMe && sendStatus == "sending"

    DisposableEffect(Unit) {
        onDispose {
            try { mediaPlayer.value?.release() } catch (_: Exception) {}
            mediaPlayer.value = null
        }
    }

    Column(modifier = Modifier.padding(start = 8.dp, end = 8.dp, top = 6.dp, bottom = 5.dp)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(44.dp)
                .clickable {
                    // Don't allow playback while still uploading or when failed.
                    if (isDownloading || isSending || isFailed) return@clickable
                    val mp = mediaPlayer.value
                    if (mp != null && isPlaying) {
                        try { mp.stop(); mp.reset() } catch (_: Exception) {}
                        isPlaying = false
                        return@clickable
                    }
                    isDownloading = true
                    Thread {
                        try {
                            val playFile = localFile ?: run {
                                val cacheDir = context.cacheDir
                                val voiceFile = java.io.File(cacheDir, "voice_${message.id}.m4a")
                                if (!voiceFile.exists() && remoteUrl != null) {
                                    java.net.URL(remoteUrl).openStream().use { input ->
                                        voiceFile.outputStream().use { output -> input.copyTo(output) }
                                    }
                                }
                                voiceFile
                            }
                            val newMp = MediaPlayer().apply {
                                setDataSource(playFile.absolutePath)
                                setOnPreparedListener {
                                    isDownloading = false
                                    isPlaying = true
                                    start()
                                }
                                setOnCompletionListener {
                                    isPlaying = false
                                    reset()
                                }
                                setOnErrorListener { _, _, _ ->
                                    isDownloading = false
                                    isPlaying = false
                                    true
                                }
                                prepareAsync()
                            }
                            mediaPlayer.value = newMp
                        } catch (e: Exception) {
                            println("[VOICE] Error downloading/playing: ${e.message}")
                            isDownloading = false
                        }
                    }.start()
                },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // Play/Stop/Downloading button
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(when {
                        isPlaying -> PrimaryGreen
                        isDownloading -> Color.Gray
                        isFailed -> Color(0xFFB00020)
                        isSending -> Color.Gray
                        else -> if (isFromMe) Color(0xFF15803D) else PrimaryGreen
                    }),
                contentAlignment = Alignment.Center
            ) {
                when {
                    isDownloading -> CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = Color.White,
                        strokeWidth = 2.dp
                    )
                    isSending -> Icon(Icons.Default.AccessTime, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
                    isFailed -> Icon(Icons.Default.Error, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
                    else -> Icon(
                        if (isPlaying) Icons.Default.Stop else Icons.Default.PlayArrow,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
            // Waveform visualization (compact)
            Row(
                modifier = Modifier.weight(1f).height(28.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                repeat(20) { i ->
                    val h = if (isPlaying) {
                        sin((i * 0.5 + System.currentTimeMillis() / 200.0) * Math.PI).toFloat() * 0.7f + 0.15f
                    } else 0.3f
                    Box(
                        modifier = Modifier
                            .width(2.5.dp)
                            .height((28 * (0.3f + h)).dp)
                            .clip(RoundedCornerShape(1.dp))
                            .background(if (isFromMe) PrimaryGreen.copy(alpha = 0.6f) else PrimaryGreen.copy(alpha = 0.4f))
                    )
                }
            }
            // Duration
            Text(
                formattedDuration,
                fontSize = 12.sp,
                color = textColor,
                fontWeight = FontWeight.Medium
            )
        }
        Spacer(Modifier.height(2.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (formattedTime.isNotEmpty()) {
                Text(formattedTime, fontSize = 10.sp, color = timeColor)
            }
            Spacer(Modifier.width(4.dp))
            MessageStatusIndicator(
                status = sendStatus,
                isFromMe = isFromMe,
                timeColor = timeColor,
                onRetry = onRetry,
                messageId = message.id
            )
        }
    }
}

@Composable
private fun ImageMessageBubble(
    message: MessageEntity, isFromMe: Boolean, bubbleColor: Color, textColor: Color, timeColor: Color, formattedTime: String,
    onRetry: ((Int) -> Unit)? = null,
) {
    // Local-first: prefer the cached local file, fall back to the server URL.
    val localFile = remember(message.localFilePath) {
        message.localFilePath?.let { java.io.File(it).takeIf { f -> f.exists() && f.length() > 0 } }
    }
    val remoteUrl = message.fileUrl?.let { "http://167.86.124.101:3000$it" }
    val model = localFile ?: remoteUrl
    val sendStatus = message.sendStatus
    val isFailed = isFromMe && sendStatus == "failed"
    val isSending = isFromMe && sendStatus == "sending"

    // Fullscreen image viewer state
    var showFullscreen by remember { mutableStateOf(false) }

    Column {
        if (model != null) {
            AsyncImage(
                model = model,
                contentDescription = "Image",
                modifier = Modifier
                    .fillMaxWidth()
                    .height(180.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { showFullscreen = true },
                contentScale = ContentScale.Crop
            )
        } else {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(180.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0xFF1A1A2A)),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(28.dp),
                    color = Color.White,
                    strokeWidth = 2.dp
                )
            }
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 5.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (message.fileSize != null) {
                Text(
                    "${(message.fileSize / 1024).toInt()} KB",
                    fontSize = 10.sp,
                    color = timeColor
                )
            } else {
                Spacer(Modifier.width(1.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (formattedTime.isNotEmpty()) {
                    Text(formattedTime, fontSize = 10.sp, color = timeColor)
                }
                MessageStatusIndicator(
                    status = sendStatus,
                    isFromMe = isFromMe,
                    timeColor = timeColor,
                    onRetry = onRetry,
                    messageId = message.id
                )
            }
        }
    }

    // Fullscreen image viewer overlay
    if (showFullscreen && model != null) {
        FullscreenImageViewer(model = model, onDismiss = { showFullscreen = false })
    }
}

@Composable
private fun FullscreenImageViewer(model: Any, onDismiss: () -> Unit) {
    // Black fullscreen overlay with the image zoomable/pannable, tap to dismiss.
    // Uses a Dialog so it floats above everything including the keyboard.
    androidx.compose.ui.window.Dialog(
        onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.DialogProperties(
            usePlatformDefaultWidth = false,
            dismissOnClickOutside = false
        )
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .clickable { onDismiss() },
            contentAlignment = Alignment.Center
        ) {
            AsyncImage(
                model = model,
                contentDescription = "Image plein ecran",
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit
            )
            // Close button at top-left
            Box(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(16.dp)
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.5f))
                    .clickable { onDismiss() },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "Fermer",
                    tint = Color.White,
                    modifier = Modifier.size(24.dp)
                )
            }
        }
    }
}

@Composable
private fun VideoMessageBubble(
    message: MessageEntity, isMe: Boolean, bubbleColor: Color, textColor: Color, timeColor: Color, formattedTime: String,
    onRetry: ((Int) -> Unit)? = null,
) {
    val localFile = remember(message.localFilePath) {
        message.localFilePath?.let { java.io.File(it).takeIf { f -> f.exists() && f.length() > 0 } }
    }
    val remoteUrl = message.fileUrl?.let { "http://167.86.124.101:3000$it" }
    val sendStatus = message.sendStatus
    val isFailed = isMe && sendStatus == "failed"
    val isSending = isMe && sendStatus == "sending"
    val hasLocal = localFile != null
    val hasUrl = remoteUrl != null

    Column {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(180.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Color(0xFF1A1A2A)),
            contentAlignment = Alignment.Center
        ) {
            when {
                isSending -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(modifier = Modifier.size(28.dp), color = Color.White, strokeWidth = 2.dp)
                    Spacer(Modifier.height(6.dp))
                    Text("Envoi…", color = Color.White, fontSize = 11.sp)
                }
                isFailed -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.Error, contentDescription = "Erreur", tint = Color(0xFFFF6B6B), modifier = Modifier.size(36.dp))
                    Spacer(Modifier.height(4.dp))
                    Text("Echec d'envoi", color = Color(0xFFFF6B6B), fontSize = 11.sp)
                }
                hasLocal || hasUrl -> Icon(Icons.Default.Videocam, contentDescription = "Video", tint = Color.White, modifier = Modifier.size(40.dp))
                else -> CircularProgressIndicator(modifier = Modifier.size(28.dp), color = Color.White, strokeWidth = 2.dp)
            }
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 5.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (message.fileSize != null) {
                Text(
                    "${(message.fileSize / 1024 / 1024).toInt()} MB",
                    fontSize = 10.sp,
                    color = timeColor
                )
            } else {
                Spacer(Modifier.width(1.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (formattedTime.isNotEmpty()) {
                    Text(formattedTime, fontSize = 10.sp, color = timeColor)
                }
                MessageStatusIndicator(
                    status = sendStatus,
                    isFromMe = isMe,
                    timeColor = timeColor,
                    onRetry = onRetry,
                    messageId = message.id
                )
            }
        }
    }
}