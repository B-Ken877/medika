package com.example.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Business
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.example.data.api.MedikaNetwork
import com.example.data.db.DoctorEntity
import com.example.ui.theme.AccentGreen
import com.example.ui.theme.Green700
import com.example.ui.theme.Neutral100
import com.example.ui.theme.Neutral200
import com.example.ui.theme.Neutral300
import com.example.ui.theme.Neutral400
import com.example.ui.theme.PrimaryGreen
import com.example.ui.theme.PrimaryGreenDark
import com.example.ui.theme.SanteSuccess
import com.example.ui.theme.SanteSuccessBg
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary
import com.example.ui.theme.TextTertiary

@Composable
fun DoctorProfileCard(
    doctor: DoctorEntity,
    onConsult: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current

    val initials = remember(doctor.name) {
        doctor.name.split(" ").filter { it.isNotBlank() }.take(2)
            .joinToString("") { it.first().uppercase() }
    }

    val resolvedAvatarUrl = remember(doctor.avatarUrl) {
        if (doctor.avatarUrl.isBlank()) null
        else if (doctor.avatarUrl.startsWith("http")) doctor.avatarUrl
        else MedikaNetwork.BASE_URL.removeSuffix("/") + doctor.avatarUrl
    }

    Surface(
        modifier = modifier.fillMaxWidth()
            .shadow(4.dp, RoundedCornerShape(18.dp), ambientColor = Color(0x0D000000), spotColor = Color(0x14000000)),
        shape = RoundedCornerShape(18.dp),
        color = Color.White,
        border = BorderStroke(0.5.dp, Neutral200.copy(alpha = 0.5f)),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Top accent bar
            Box(
                modifier = Modifier.fillMaxWidth().height(3.dp)
                    .background(Brush.horizontalGradient(listOf(PrimaryGreen.copy(alpha = 0.5f), AccentGreen, PrimaryGreen.copy(alpha = 0.5f))))
            )

            // Avatar + Name row (horizontal layout to save vertical space)
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 16.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Avatar - compact
                Box(contentAlignment = Alignment.Center) {
                    Box(
                        modifier = Modifier.size(72.dp)
                            .background(
                                if (doctor.isAvailable) SanteSuccess.copy(alpha = 0.1f) else Neutral200.copy(alpha = 0.4f),
                                CircleShape
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(
                            modifier = Modifier.size(64.dp).clip(CircleShape)
                                .border(2.5.dp, if (doctor.isAvailable) PrimaryGreen.copy(alpha = 0.25f) else Neutral200, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (resolvedAvatarUrl != null) {
                                AsyncImage(
                                    model = ImageRequest.Builder(context).data(resolvedAvatarUrl).crossfade(true).build(),
                                    contentDescription = doctor.name,
                                    modifier = Modifier.size(64.dp).clip(CircleShape),
                                    contentScale = ContentScale.Crop,
                                )
                            } else {
                                Box(
                                    modifier = Modifier.size(64.dp)
                                        .background(Brush.verticalGradient(listOf(PrimaryGreen, PrimaryGreenDark)), CircleShape),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(text = initials, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                                }
                            }
                        }
                        if (doctor.isAvailable) {
                            Box(modifier = Modifier.align(Alignment.BottomEnd).padding(bottom = 2.dp).size(14.dp)
                                .background(Color.White, CircleShape).padding(2.5.dp)
                                .background(SanteSuccess, CircleShape).border(1.5.dp, Color.White, CircleShape))
                        }
                    }
                }

                Spacer(modifier = Modifier.width(14.dp))

                // Name + Specialty + Availability - right of avatar
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = doctor.name, style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        if (doctor.isAvailable) {
                            Box(modifier = Modifier.size(7.dp).background(SanteSuccess, CircleShape))
                        }
                    }
                    Spacer(modifier = Modifier.height(3.dp))
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = PrimaryGreen.copy(alpha = 0.08f),
                    ) {
                        Text(text = doctor.specialty, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = Green700,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = if (doctor.isAvailable) "Disponible maintenant" else "Indisponible",
                        fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
                        color = if (doctor.isAvailable) Green700 else TextTertiary,
                    )
                }
            }

            // Info rows: Hospital, Location, License - compact single section
            val hasInfo = doctor.hospital.isNotBlank() || doctor.location.isNotBlank() || doctor.licenseNumber.isNotBlank()
            if (hasInfo) {
                Spacer(modifier = Modifier.height(10.dp))
                Column(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    if (doctor.hospital.isNotBlank()) {
                        InfoRowCompact(icon = Icons.Default.Business, text = doctor.hospital.trim(), iconTint = PrimaryGreen)
                    }
                    if (doctor.location.isNotBlank()) {
                        InfoRowCompact(icon = Icons.Default.LocationOn, text = doctor.location.trim(), iconTint = Neutral400)
                    }
                    if (doctor.licenseNumber.isNotBlank()) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 2.dp)) {
                            Icon(imageVector = Icons.Default.VerifiedUser, contentDescription = null, tint = SanteSuccess, modifier = Modifier.size(13.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(text = "Licence: ${doctor.licenseNumber.trim()}", fontSize = 11.sp, color = TextTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }

            // Biography - compact
            if (doctor.biography.isNotBlank()) {
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    text = "\u201C${doctor.biography.trim()}\u201D",
                    fontSize = 12.sp, color = TextSecondary, lineHeight = 17.sp,
                    modifier = Modifier.padding(horizontal = 22.dp), maxLines = 2, overflow = TextOverflow.Ellipsis,
                    fontStyle = FontStyle.Italic,
                )
            }

            Spacer(modifier = Modifier.height(14.dp))

            // Consulter Button
            Surface(
                onClick = onConsult,
                shape = RoundedCornerShape(12.dp),
                color = if (doctor.isAvailable) PrimaryGreen else Neutral300,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp).height(44.dp),
            ) {
                Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxWidth()) {
                    Text(text = "Consulter", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color.White, letterSpacing = 0.5.sp)
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun InfoRowCompact(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    text: String,
    iconTint: Color = Neutral400,
) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 2.dp)) {
        Icon(imageVector = icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(13.dp))
        Spacer(modifier = Modifier.width(6.dp))
        Text(text = text, fontSize = 11.5.sp, color = TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
