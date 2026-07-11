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
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.outlined.Star
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
import com.example.ui.theme.SanteWarning
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary
import com.example.ui.theme.TextTertiary
import java.util.Locale
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme

@Composable
fun DoctorProfileCard(
    doctor: DoctorEntity,
    onConsult: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current

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

    val resolvedAvatarUrl = remember(doctor.avatarUrl) {
        if (doctor.avatarUrl.isBlank()) null
        else if (doctor.avatarUrl.startsWith("http")) doctor.avatarUrl
        else MedikaNetwork.BASE_URL.removeSuffix("/") + doctor.avatarUrl
    }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .shadow(6.dp, RoundedCornerShape(20.dp), ambientColor = Color(0x0D000000), spotColor = Color(0x1A000000)),
        shape = RoundedCornerShape(20.dp),
        color = Color.White,
        border = BorderStroke(0.5.dp, Neutral200.copy(alpha = 0.6f)),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Top accent bar
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .background(
                        Brush.horizontalGradient(
                            colors = listOf(
                                PrimaryGreen.copy(alpha = 0.6f),
                                AccentGreen,
                                PrimaryGreen.copy(alpha = 0.6f),
                            )
                        )
                    )
            )

            // Avatar section
            Box(
                modifier = Modifier.padding(top = 24.dp, bottom = 16.dp),
                contentAlignment = Alignment.Center,
            ) {
                // Outer glow ring
                Box(
                    modifier = Modifier
                        .size(116.dp)
                        .background(
                            if (doctor.isAvailable) SanteSuccess.copy(alpha = 0.12f)
                            else Neutral200.copy(alpha = 0.5f),
                            CircleShape
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    // Avatar
                    Box(
                        modifier = Modifier
                            .size(104.dp)
                            .clip(CircleShape)
                            .border(
                                3.dp,
                                if (doctor.isAvailable) PrimaryGreen.copy(alpha = 0.3f) else Neutral200,
                                CircleShape
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (resolvedAvatarUrl != null) {
                            AsyncImage(
                                model = ImageRequest.Builder(context)
                                    .data(resolvedAvatarUrl)
                                    .crossfade(true)
                                    .build(),
                                contentDescription = doctor.name,
                                modifier = Modifier
                                    .size(104.dp)
                                    .clip(CircleShape),
                                contentScale = ContentScale.Crop,
                            )
                        } else {
                            Box(
                                modifier = Modifier
                                    .size(104.dp)
                                    .background(
                                        Brush.verticalGradient(
                                            colors = listOf(PrimaryGreen, PrimaryGreenDark)
                                        ),
                                        CircleShape
                                    ),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = initials,
                                    color = Color.White,
                                    fontSize = 32.sp,
                                    fontWeight = FontWeight.Bold,
                                    textAlign = TextAlign.Center,
                                )
                            }
                        }
                    }

                    // Online indicator dot
                    if (doctor.isAvailable) {
                        Box(
                            modifier = Modifier
                                .align(Alignment.BottomEnd)
                                .padding(end = 2.dp, bottom = 4.dp)
                                .size(18.dp)
                                .background(Color.White, CircleShape)
                                .padding(3.dp)
                                .background(SanteSuccess, CircleShape)
                                .border(2.dp, Color.White, CircleShape),
                        )
                    }
                }
            }

            // Doctor Name
            Text(
                text = doctor.name,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 20.dp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )

            Spacer(modifier = Modifier.height(6.dp))

            // Specialty Badge
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = PrimaryGreen.copy(alpha = 0.08f),
                border = BorderStroke(0.5.dp, PrimaryGreen.copy(alpha = 0.2f)),
            ) {
                Text(
                    text = doctor.specialty,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Green700,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 5.dp),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            Spacer(modifier = Modifier.height(14.dp))

            // Star Rating
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = SanteWarning.copy(alpha = 0.06f),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    repeat(5) { index ->
                        Icon(
                            imageVector = if (index < fullStars) Icons.Filled.Star
                                         else if (index == fullStars && hasHalf) Icons.Filled.Star
                                         else Icons.Outlined.Star,
                            contentDescription = null,
                            tint = if (index < fullStars) SanteWarning
                                   else if (index == fullStars && hasHalf) SanteWarning.copy(alpha = 0.5f)
                                   else Neutral300,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = String.format(Locale.getDefault(), "%.1f", ratingValue),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = TextSecondary,
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Info rows: Hospital, Location, License
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (doctor.hospital.isNotBlank()) {
                    InfoRow(
                        icon = Icons.Default.Business,
                        text = doctor.hospital.trim(),
                        iconTint = PrimaryGreen,
                    )
                }

                if (doctor.location.isNotBlank()) {
                    InfoRow(
                        icon = Icons.Default.LocationOn,
                        text = doctor.location.trim(),
                        iconTint = Neutral400,
                    )
                }

                if (doctor.licenseNumber.isNotBlank()) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(start = 4.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Default.VerifiedUser,
                            contentDescription = null,
                            tint = SanteSuccess,
                            modifier = Modifier.size(15.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Licence: ${doctor.licenseNumber.trim()}",
                            fontSize = 11.5.sp,
                            color = TextTertiary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }

            // Biography
            if (doctor.biography.isNotBlank()) {
                Spacer(modifier = Modifier.height(14.dp))
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp),
                    shape = RoundedCornerShape(12.dp),
                    color = Neutral100,
                ) {
                    Text(
                        text = "\"${doctor.biography.trim()}\"",
                        fontSize = 13.sp,
                        color = TextSecondary,
                        lineHeight = 19.sp,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                        fontStyle = FontStyle.Italic,
                    )
                }
            }

            // Availability badge
            Spacer(modifier = Modifier.height(14.dp))
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = if (doctor.isAvailable) SanteSuccessBg else Neutral100,
                border = BorderStroke(
                    0.5.dp,
                    if (doctor.isAvailable) SanteSuccess.copy(alpha = 0.3f) else Neutral200
                ),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    Box(
                        modifier = Modifier
                            .size(7.dp)
                            .background(
                                if (doctor.isAvailable) SanteSuccess else Neutral400,
                                CircleShape
                            )
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = if (doctor.isAvailable) "Disponible maintenant"
                               else "Indisponible",
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (doctor.isAvailable) Green700 else TextTertiary,
                    )
                }
            }

            Spacer(modifier = Modifier.height(18.dp))

            // Consulter Button
            Surface(
                onClick = onConsult,
                shape = RoundedCornerShape(14.dp),
                color = if (doctor.isAvailable) PrimaryGreen else Neutral300,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .height(50.dp),
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = "Consulter",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                        letterSpacing = 0.5.sp,
                    )
                }
            }

            Spacer(modifier = Modifier.height(20.dp))
        }
    }
}

@Composable
private fun InfoRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    text: String,
    iconTint: Color = Neutral400,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(start = 4.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = iconTint,
            modifier = Modifier.size(15.dp),
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = text,
            fontSize = 12.5.sp,
            color = TextSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
