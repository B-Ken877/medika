package com.example.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.DirectionsRun
import androidx.compose.material.icons.filled.LocalHospital
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.WaterDrop
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.R
import com.example.data.db.ConsultationEntity
import com.example.ui.SanteViewModel
import com.example.ui.components.AnimatedButton
import com.example.ui.components.ConsultationCard
import com.example.ui.components.DepthCard
import com.example.ui.components.StatCard
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.material.icons.filled.Elderly
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FitnessCenter
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.Healing
import androidx.compose.material.icons.filled.SelfImprovement
import androidx.compose.material.icons.filled.Spa
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.material.icons.filled.Vaccines
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import com.example.ui.theme.*
import coil.compose.AsyncImage
import coil.request.ImageRequest
import androidx.compose.ui.platform.LocalContext

// ═══════════════════════════════════════════════════════════════════════════════
// PatientDashboardScreen — Professional medical home screen (MyChart quality)
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
fun PatientDashboardScreen(
    viewModel: SanteViewModel,
    onNavigate: (String) -> Unit,
) {
    val profile by viewModel.patientProfile.collectAsStateWithLifecycle()
    val authState by viewModel.authState.collectAsStateWithLifecycle()
    val consultations by viewModel.allConsultations.collectAsStateWithLifecycle()
    val wsConnected by viewModel.wsConnected.collectAsStateWithLifecycle()

    val serverUser = (authState as? com.example.ui.AuthState.PatientAuthenticated)?.serverUser
    val avatarUrl = serverUser?.avatar_url

    // Sync from server every time dashboard appears
    LaunchedEffect(Unit) {
        viewModel.refreshConsultations()
    }

    val firstName = profile?.name?.split(" ")?.firstOrNull() ?: "Patient"

    // ── Derived stats ──
    val enCoursCount = consultations.count { it.status == "EN_COURS" }
    val enAttenteCount = consultations.count {
        it.status == "RECHERCHE_MEDECIN" || it.status == "RECHERCHE"
    }
    val termineCount = consultations.count { it.status == "TERMINE" }
    val hasUnread = consultations.any {
        it.status == "RECHERCHE_MEDECIN" || it.status == "RECHERCHE" || it.status == "EN_COURS"
    }

    val recentConsultations = consultations
        .filter { it.status != "REFUSE" }
        .sortedByDescending { it.timestamp }
        .take(10)

    // ── Main scrollable column ──
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SanteBackground)
            .verticalScroll(rememberScrollState())
    ) {

        // ══════════════════════════════════════════════════════════════════════
        // 1. TOP HEADER BAR — Green gradient, logo, greeting, notifications
        // ══════════════════════════════════════════════════════════════════════
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(600)) +
                    slideInVertically(
                        initialOffsetY = { -50 },
                        animationSpec = tween(600)
                    ),
        ) {
            GradientHeaderBar(
                firstName = firstName,
                hasUnread = hasUnread,
                wsConnected = wsConnected,
                avatarUrl = avatarUrl,
                onNotificationClick = { onNavigate("notifications") },
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        // ══════════════════════════════════════════════════════════════════════
        // 2. QUICK ACTIONS ROW — 3 action circles
        // ══════════════════════════════════════════════════════════════════════
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(500, delayMillis = 80)) +
                    slideInVertically(
                        initialOffsetY = { 30 },
                        animationSpec = tween(500, delayMillis = 80),
                    ),
        ) {
            QuickActionsRow(onNavigate = onNavigate)
        }

        Spacer(modifier = Modifier.height(28.dp))

        // ══════════════════════════════════════════════════════════════════════
        // 3. STATS ROW — 3 stat cards
        // ══════════════════════════════════════════════════════════════════════
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(500, delayMillis = 160)) +
                    slideInVertically(
                        initialOffsetY = { 30 },
                        animationSpec = tween(500, delayMillis = 160),
                    ),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatCard(
                    modifier = Modifier.weight(1f),
                    title = "En cours",
                    value = enCoursCount.toString(),
                    icon = Icons.AutoMirrored.Filled.Chat,
                    tint = SanteSuccessBg,
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    title = "En attente",
                    value = enAttenteCount.toString(),
                    icon = Icons.Default.Schedule,
                    tint = SanteWarningBg,
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    title = "Terminées",
                    value = termineCount.toString(),
                    icon = Icons.Default.LocalHospital,
                    tint = SanteInfoBg,
                )
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        // ══════════════════════════════════════════════════════════════════════
        // 4. RECENT CONSULTATIONS SECTION
        // ══════════════════════════════════════════════════════════════════════
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(500, delayMillis = 240)) +
                    slideInVertically(
                        initialOffsetY = { 30 },
                        animationSpec = tween(500, delayMillis = 240),
                    ),
        ) {
            Column(modifier = Modifier.padding(horizontal = 16.dp)) {

                // Section header
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Consultations Récentes",
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary,
                        ),
                    )
                    TextButton(onClick = { onNavigate("consultation_history") }) {
                        Text(
                            text = "Voir tout",
                            color = PrimaryGreen,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))

                if (recentConsultations.isEmpty()) {
                    EmptyConsultationsState(onNavigate = onNavigate)
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        recentConsultations.forEach { consultation ->
                            ConsultationCard(
                                consultation = consultation,
                                onClick = {
                                    viewModel.setActiveConsultation(consultation.id)
                                    onNavigate("chat")
                                },
                            )
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        // ══════════════════════════════════════════════════════════════════════
        // ══════════════════════════════════════════════════════════════════════
        // 5. HEALTH TIPS SECTION — Auto-scrolling carousel
        // ══════════════════════════════════════════════════════════════════════
        AnimatedVisibility(
            visible = true,
            enter = fadeIn(animationSpec = tween(500, delayMillis = 320)) +
                    slideInVertically(
                        initialOffsetY = { 30 },
                        animationSpec = tween(500, delayMillis = 320),
                    ),
        ) {
            HealthTipsCarousel()
        }
        // Bottom spacing for navigation bar
        Spacer(modifier = Modifier.height(80.dp))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRADIENT HEADER BAR — Green gradient with rounded bottom corners
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
private fun GradientHeaderBar(
    firstName: String,
    hasUnread: Boolean,
    wsConnected: Boolean,
    avatarUrl: String? = null,
    onNotificationClick: () -> Unit,
) {
    val context = LocalContext.current
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(bottomStart = 24.dp, bottomEnd = 24.dp))
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(PrimaryGreen, Green700),
                ),
            ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 16.dp, top = 20.dp, bottom = 24.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {

            // ── Left: Avatar/Logo + Greeting ──
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (avatarUrl != null) {
                    AsyncImage(
                        model = ImageRequest.Builder(context)
                            .data(avatarUrl)
                            .crossfade(true)
                            .build(),
                        contentDescription = "Avatar",
                        modifier = Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                            .border(2.dp, Color.White, CircleShape),
                        contentScale = ContentScale.Crop
                    )
                } else {
                    Icon(
                        painter = painterResource(R.drawable.medika_logo_header),
                        contentDescription = "Medika",
                        modifier = Modifier.size(64.dp),
                        tint = Color.Unspecified,
                    )
                }
                Spacer(modifier = Modifier.width(14.dp))
                Column {
                    Text(
                        text = "Bonjour,",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.White.copy(alpha = 0.85f),
                    )
                    Text(
                        text = firstName,
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                        ),
                    )
                }
            }

            // ── Right: Connection dot + Notification bell ──
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Connection indicator
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .shadow(2.dp, CircleShape)
                        .background(
                            color = if (wsConnected) Color.White else SanteWarning,
                            shape = CircleShape,
                        ),
                )
                Spacer(modifier = Modifier.width(12.dp))

                // Notification bell with unread dot
                Box(contentAlignment = Alignment.Center) {
                    IconButton(onClick = onNotificationClick) {
                        Icon(
                            imageVector = Icons.Default.Notifications,
                            contentDescription = "Notifications",
                            tint = Color.White,
                            modifier = Modifier.size(26.dp),
                        )
                    }
                    if (hasUnread) {
                        Box(
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .padding(end = 4.dp, top = 6.dp)
                                .size(10.dp)
                                .background(SanteDanger, CircleShape),
                        )
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUICK ACTIONS ROW — 3 circular action buttons
// ═══════════════════════════════════════════════════════════════════════════════

private val ActionPurple = Color(0xFF8B5CF6)

@Composable
private fun QuickActionsRow(onNavigate: (String) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        QuickActionItem(
            label = "Nouvelle\nConsultation",
            icon = Icons.Default.Add,
            backgroundColor = PrimaryGreen,
            onClick = { onNavigate("intake") },
        )
        QuickActionItem(
            label = "Mes\nConsultations",
            icon = Icons.AutoMirrored.Filled.Chat,
            backgroundColor = SanteInfo,
            onClick = { onNavigate("chat") },
        )
        QuickActionItem(
            label = "Mon\nProfil",
            icon = Icons.Default.Person,
            backgroundColor = ActionPurple,
            onClick = { onNavigate("profile") },
        )
    }
}

@Composable
private fun QuickActionItem(
    label: String,
    icon: ImageVector,
    backgroundColor: Color,
    onClick: () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.width(100.dp),
    ) {
        Box(
            modifier = Modifier
                .size(52.dp)
                .shadow(6.dp, CircleShape)
                .background(backgroundColor, CircleShape)
                .clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = Color.White,
                modifier = Modifier.size(26.dp),
            )
        }
        Spacer(modifier = Modifier.height(10.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = TextPrimary,
            textAlign = TextAlign.Center,
            fontWeight = FontWeight.Medium,
            lineHeight = 16.sp,
        )
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMPTY CONSULTATIONS STATE — Illustration + CTA
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
private fun EmptyConsultationsState(onNavigate: (String) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Illustration circle
        Box(
            modifier = Modifier
                .size(80.dp)
                .background(Green50, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Default.LocalHospital,
                contentDescription = null,
                modifier = Modifier.size(40.dp),
                tint = Green300,
            )
        }
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "Aucune consultation",
            style = MaterialTheme.typography.bodyLarge,
            color = TextSecondary,
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = "Commencez votre première consultation\navec un médecin maintenant",
            style = MaterialTheme.typography.bodySmall,
            color = TextTertiary,
            textAlign = TextAlign.Center,
            lineHeight = 18.sp,
        )
        Spacer(modifier = Modifier.height(20.dp))
        AnimatedButton(
            onClick = { onNavigate("intake") },
            text = "Commencer une consultation",
        )
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH TIPS — Data model + auto-scrolling carousel + cards
// ═══════════════════════════════════════════════════════════════════════════════

private data class HealthTip(
    val title: String,
    val description: String,
    val icon: ImageVector,
    val accentColor: Color,
    val bgColor: Color,
)

private val healthTips = listOf(
    HealthTip(
        title = "Hydratez-vous",
        description = "Buvez au moins 8 verres d'eau par jour pour maintenir une bonne santé.",
        icon = Icons.Default.WaterDrop,
        accentColor = SanteInfo,
        bgColor = SanteInfoBg,
    ),
    HealthTip(
        title = "Sommeil réparateur",
        description = "Visez 7 à 8 heures de sommeil chaque nuit pour une récupération optimale.",
        icon = Icons.Default.Bedtime,
        accentColor = ActionPurple,
        bgColor = Color(0xFFF5F3FF),
    ),
    HealthTip(
        title = "Activité physique",
        description = "30 minutes de marche quotidienne renforcent votre coeur et votre esprit.",
        icon = Icons.Default.DirectionsRun,
        accentColor = SanteWarning,
        bgColor = SanteWarningBg,
    ),
    HealthTip(
        title = "Nutrition équilibrée",
        description = "Privilégiez les fruits, légumes et protéines maigres à chaque repas.",
        icon = Icons.Default.Restaurant,
        accentColor = Color(0xFF059669),
        bgColor = Color(0xFFECFDF5),
    ),
    HealthTip(
        title = "Soleil et vitamine D",
        description = "Exposez-vous au soleil 15 min par jour pour favoriser la vitamine D.",
        icon = Icons.Default.WbSunny,
        accentColor = Color(0xFFD97706),
        bgColor = Color(0xFFFFFBEB),
    ),
    HealthTip(
        title = "Santé mentale",
        description = "Prenez du temps pour vous: méditation, lecture ou simple respiration profonde.",
        icon = Icons.Default.SelfImprovement,
        accentColor = ActionPurple,
        bgColor = Color(0xFFF5F3FF),
    ),
    HealthTip(
        title = "Vaccination à jour",
        description = "Vérifiez vos vaccins et faites les rappels recommandés par votre médecin.",
        icon = Icons.Default.Vaccines,
        accentColor = Color(0xFF0284C7),
        bgColor = Color(0xFFF0F9FF),
    ),
    HealthTip(
        title = "Coeur en forme",
        description = "Surveillez votre tension artérielle régulièrement pour prévenir les risques.",
        icon = Icons.Default.Favorite,
        accentColor = Color(0xFFE11D48),
        bgColor = Color(0xFFFFF1F2),
    ),
    HealthTip(
        title = "Bien-être physique",
        description = "Le renforcement musculaire 2 fois par semaine maintient votre mobilité.",
        icon = Icons.Default.FitnessCenter,
        accentColor = Color(0xFF7C3AED),
        bgColor = Color(0xFFF5F3FF),
    ),
    HealthTip(
        title = "Soins du corps",
        description = "Lavez-vous les mains régulièrement et consultez au moindre doute.",
        icon = Icons.Default.Healing,
        accentColor = PrimaryGreen,
        bgColor = Color(0xFFECFDF5),
    ),
    HealthTip(
        title = "Détente et spa",
        description = "Un bain chaud ou une douche tiède aide à relâcher les tensions.",
        icon = Icons.Default.Spa,
        accentColor = Color(0xFF0891B2),
        bgColor = Color(0xFFECFEFF),
    ),
    HealthTip(
        title = "Santé des aînés",
        description = "Les personnes âgées doivent faire un bilan de santé au moins 2 fois par an.",
        icon = Icons.Default.Elderly,
        accentColor = Color(0xFF92400E),
        bgColor = Color(0xFFFFF7ED),
    ),
)

@Composable
private fun HealthTipsCarousel() {
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()

    // Repeat tips 50x for infinite loop, start in the middle
    val repeatedTips = remember { List(50) { healthTips }.flatten() }
    val startIndex = remember { healthTips.size * 25 }

    // Current tip index for dot indicator
    var currentTipIndex by remember { mutableIntStateOf(0) }

    // Auto-scroll every 3.5 seconds
    LaunchedEffect(Unit) {
        listState.scrollToItem(startIndex)
        while (true) {
            delay(3500L)
            val next = listState.firstVisibleItemIndex + 1
            listState.animateScrollToItem(next)
        }
    }

    // Track current visible tip for dots
    LaunchedEffect(listState.firstVisibleItemIndex) {
        currentTipIndex = listState.firstVisibleItemIndex % healthTips.size
    }

    Column(modifier = Modifier.padding(horizontal = 16.dp)) {
        Text(
            text = "Conseils Santé",
            style = MaterialTheme.typography.titleLarge.copy(
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
            ),
        )

        Spacer(modifier = Modifier.height(14.dp))

        LazyRow(
            state = listState,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            items(
                items = repeatedTips,
                key = { "${it.title}_${listState.firstVisibleItemIndex}" }
            ) { tip ->
                HealthTipCard(tip = tip)
            }
        }

        Spacer(modifier = Modifier.height(10.dp))

        // Dot indicators
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
        ) {
            healthTips.forEachIndexed { index, _ ->
                Box(
                    modifier = Modifier
                        .padding(horizontal = 3.dp)
                        .size(
                            width = if (index == currentTipIndex) 18.dp else 6.dp,
                            height = 6.dp,
                        )
                        .clip(RoundedCornerShape(3.dp))
                        .background(
                            if (index == currentTipIndex) PrimaryGreen
                            else Neutral300
                        ),
                )
            }
        }
    }
}

@Composable
private fun HealthTipCard(tip: HealthTip) {
    DepthCard(
        modifier = Modifier.width(220.dp),
        elevationLevel = 1,
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Colored icon circle
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .background(tip.bgColor, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = tip.icon,
                    contentDescription = null,
                    tint = tip.accentColor,
                    modifier = Modifier.size(24.dp),
                )
            }
            Spacer(modifier = Modifier.height(14.dp))
            Text(
                text = tip.title,
                style = MaterialTheme.typography.titleSmall.copy(
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary,
                ),
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = tip.description,
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
                lineHeight = 18.sp,
            )
        }
    }
}
