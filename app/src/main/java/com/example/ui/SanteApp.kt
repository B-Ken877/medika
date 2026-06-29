package com.example.ui

import androidx.activity.OnBackPressedDispatcher
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ui.screens.AdminDashboardScreen
import com.example.ui.screens.AuthScreen
import com.example.ui.screens.ChatScreen
import com.example.ui.screens.DoctorDashboardScreen
import com.example.ui.screens.PatientDashboardScreen
import com.example.ui.screens.ProfileScreen
import com.example.ui.screens.NotificationsScreen
import com.example.ui.screens.RegistrationScreen
import com.example.ui.screens.SymptomIntakeScreen
import com.example.ui.theme.*
import kotlinx.coroutines.launch

private val screenOrder = listOf("auth", "register", "home", "intake", "chat", "profile", "notifications")

// Navigation history for back button support
private val screenBackMap = mapOf(
    "register" to "auth",
    "intake" to "home",
    "chat" to "home",
    "profile" to "home",
    "notifications" to "home"
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SanteApp(
    viewModel: SanteViewModel,
    modifier: Modifier = Modifier
) {
    val authState by viewModel.authState.collectAsStateWithLifecycle()
    // activeCall no longer observed — ZEGOCLOUD UIKit manages the call UI.
    val activeConsultationId by viewModel.activeConsultationId.collectAsStateWithLifecycle()
    val wsConnected by viewModel.wsConnected.collectAsStateWithLifecycle()

    var currentScreen by remember { mutableStateOf("auth") }
    var showBottomSheet by remember { mutableStateOf(false) }

    // ─── Call Permission Handling ──────────────────────────────────────
    val requestCallPerms by viewModel.requestCallPermissions.collectAsStateWithLifecycle()
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { perms ->
        val granted = perms.values.all { it }
        if (viewModel.pendingIncomingCall != null) {
            viewModel.onIncomingCallPermissionsResult(granted)
        } else {
            viewModel.onCallPermissionsResult(granted)
        }
    }

    LaunchedEffect(requestCallPerms) {
        if (requestCallPerms) {
            val perms = mutableListOf(Manifest.permission.RECORD_AUDIO)
            if (viewModel.pendingCallNeedsVideo) perms.add(Manifest.permission.CAMERA)
            permissionLauncher.launch(perms.toTypedArray())
        }
    }

    // ─── Handle Android back button ────────────────────────────────────
    val backDispatcher = LocalContext.current as? androidx.activity.ComponentActivity
    DisposableEffect(backDispatcher) {
        val callback = object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val target = screenBackMap[currentScreen]
                if (target != null) {
                    currentScreen = target
                } else if (currentScreen == "home") {
                    // On home screen, let system handle (exit app)
                    isEnabled = false
                    backDispatcher?.onBackPressedDispatcher?.onBackPressed()
                    isEnabled = true
                }
            }
        }
        backDispatcher?.onBackPressedDispatcher?.addCallback(callback)
        onDispose { callback.remove() }
    }

    // Auto-navigate when activeConsultationId becomes non-null
    LaunchedEffect(activeConsultationId) {
        if (activeConsultationId != null && currentScreen != "chat") {
            currentScreen = "chat"
        }
    }

    // Sync auth state
    LaunchedEffect(authState) {
        when (authState) {
            is AuthState.Unauthenticated -> currentScreen = "auth"
            is AuthState.PatientAuthenticated,
            is AuthState.DoctorAuthenticated,
            is AuthState.AdminAuthenticated -> {
                if (currentScreen == "auth" || currentScreen == "register") currentScreen = "home"
            }
            else -> {}
        }
    }

    // Bottom Sheet
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    if (showBottomSheet) {
        ModalBottomSheet(
            onDismissRequest = { showBottomSheet = false },
            sheetState = sheetState,
            containerColor = Color.White,
            shape = androidx.compose.foundation.shape.RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
            dragHandle = {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp, bottom = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Box(
                        modifier = Modifier
                            .width(40.dp)
                            .height(4.dp)
                            .clip(androidx.compose.foundation.shape.RoundedCornerShape(2.dp))
                            .background(Green200)
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "Menu",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                    Spacer(modifier = Modifier.height(4.dp))

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .background(if (wsConnected) Green500 else SanteDanger, androidx.compose.foundation.shape.CircleShape)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = if (wsConnected) "Connecte au serveur" else "Connexion...",
                            fontSize = 12.sp,
                            color = if (wsConnected) Green700 else SanteWarning,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    Spacer(modifier = Modifier.height(16.dp))
                    HorizontalDivider(color = Green100, thickness = 1.dp)
                }
            }
        ) {
            NavSheetContent(
                currentScreen = currentScreen,
                activeConsultationId = activeConsultationId,
                onItemClick = { route ->
                    scope.launch { sheetState.hide() }.invokeOnCompletion {
                        showBottomSheet = false
                    }
                    when (route) {
                        "home" -> currentScreen = "home"
                        "chat" -> if (activeConsultationId != null) currentScreen = "chat"
                        "profile" -> currentScreen = "profile"
                        "notifications" -> currentScreen = "notifications"
                        "logout" -> viewModel.logout()
                    }
                },
                onDismiss = {
                    scope.launch { sheetState.hide() }.invokeOnCompletion {
                        showBottomSheet = false
                    }
                }
            )
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(SanteBackground)
    ) {
        // Main content
        AnimatedContent(
            targetState = currentScreen,
            transitionSpec = {
                val oldIndex = screenOrder.indexOf(initialState).coerceAtLeast(0)
                val newIndex = screenOrder.indexOf(targetState).coerceAtLeast(0)
                val forward = newIndex > oldIndex
                if (forward) {
                    slideInHorizontally(initialOffsetX = { it }) + fadeIn() togetherWith
                            slideOutHorizontally(targetOffsetX = { -it }) + fadeOut()
                } else {
                    slideInHorizontally(initialOffsetX = { -it }) + fadeIn() togetherWith
                            slideOutHorizontally(targetOffsetX = { it }) + fadeOut()
                }
            },
            label = "screen_transition"
        ) { screen ->
            when (screen) {
                "auth" -> AuthScreen(
                    viewModel = viewModel,
                    onNavigateToRegister = { currentScreen = "register" }
                )

                "register" -> RegistrationScreen(
                    viewModel = viewModel,
                    onBack = { currentScreen = "auth" }
                )

                "home" -> when (authState) {
                    is AuthState.PatientAuthenticated -> PatientDashboardScreen(
                        viewModel = viewModel,
                        onNavigate = { route ->
                            when (route) {
                                "intake" -> currentScreen = "intake"
                                "chat" -> currentScreen = "chat"
                                "profile" -> currentScreen = "profile"
                                "notifications" -> currentScreen = "notifications"
                            }
                        }
                    )
                    is AuthState.DoctorAuthenticated -> DoctorDashboardScreen(
                        viewModel = viewModel,
                        onNavigate = { route ->
                            when (route) {
                                "chat" -> currentScreen = "chat"
                            }
                        }
                    )
                    is AuthState.AdminAuthenticated -> AdminDashboardScreen(
                        viewModel = viewModel,
                        onNavigate = { route ->
                            when (route) { "chat" -> currentScreen = "chat" }
                        }
                    )
                    else -> AuthScreen(viewModel)
                }

                "intake" -> SymptomIntakeScreen(viewModel = viewModel)

                "chat" -> ChatScreen(
                    viewModel = viewModel,
                    onBack = { currentScreen = "home" }
                )

                "profile" -> ProfileScreen(
                    viewModel = viewModel,
                    onBack = { currentScreen = "home" }
                )

                "notifications" -> NotificationsScreen(
                    viewModel = viewModel,
                    onBack = { currentScreen = "home" }
                )
            }
        }

        // FAB
        if (authState !is AuthState.Unauthenticated && authState !is AuthState.Loading &&
            currentScreen !in listOf("auth", "chat", "register")) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(bottom = 24.dp),
                contentAlignment = Alignment.BottomCenter
            ) {
                Box(
                    modifier = Modifier
                        .size(68.dp)
                        .graphicsLayer {
                            scaleX = 1.15f
                            scaleY = 1.15f
                            alpha = 0.15f
                        }
                        .background(PrimaryGreen, androidx.compose.foundation.shape.CircleShape)
                )

                Surface(
                    onClick = { showBottomSheet = true },
                    modifier = Modifier
                        .size(60.dp)
                        .shadow(8.dp, androidx.compose.foundation.shape.CircleShape),
                    shape = androidx.compose.foundation.shape.CircleShape,
                    color = PrimaryGreen
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.Menu,
                            contentDescription = "Menu",
                            tint = Color.White,
                            modifier = Modifier.size(28.dp)
                        )
                    }
                }
            }
        }

        // ZEGOCLOUD UIKit handles the call UI entirely (ringing, call screen,
        // hang-up). No custom CallScreen overlay is needed.
    }
}

// ─── Nav Sheet Content ───────────────────────────────────────────────────────

private data class NavItem(
    val route: String,
    val label: String,
    val subtitle: String,
    val icon: ImageVector
)

@Composable
private fun NavSheetContent(
    currentScreen: String,
    activeConsultationId: String?,
    onItemClick: (String) -> Unit,
    onDismiss: () -> Unit
) {
    val items = remember {
        listOf(
            NavItem("home", "Accueil", "Tableau de bord", Icons.Default.Home),
            NavItem("chat", "Consultations", "Messages en temps reel", Icons.AutoMirrored.Filled.Chat),
            NavItem("profile", "Profil", "Mes informations", Icons.Default.Person),
            NavItem("logout", "Deconnexion", "Se deconnecter", Icons.Default.Close)
        )
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .padding(bottom = 32.dp)
    ) {
        items.forEach { item ->
            val isActive = currentScreen == item.route || (item.route == "home" && currentScreen == "intake")
            val isDisabled = item.route == "chat" && activeConsultationId == null
            val isLogout = item.route == "logout"

            Surface(
                onClick = {
                    if (!isDisabled) onItemClick(item.route)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
                shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
                color = if (isActive) Green50 else Color.Transparent
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(42.dp)
                            .background(
                                if (isActive) PrimaryGreen else Green50,
                                androidx.compose.foundation.shape.CircleShape
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        CompositionLocalProvider(LocalContentColor provides if (isActive) Color.White else PrimaryGreen) {
                            Icon(
                                imageVector = item.icon,
                                contentDescription = item.label,
                                modifier = Modifier.size(22.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.width(16.dp))

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = item.label,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (isLogout) SanteDanger else TextPrimary
                        )
                        Text(
                            text = item.subtitle,
                            fontSize = 12.sp,
                            color = if (isDisabled) TextSecondary.copy(alpha = 0.4f) else TextSecondary
                        )
                    }

                    if (isActive) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .background(PrimaryGreen, androidx.compose.foundation.shape.CircleShape)
                        )
                    }
                }
            }
        }
    }
}