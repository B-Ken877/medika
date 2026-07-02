package com.example.ui

import android.app.Activity
import android.Manifest
import androidx.activity.OnBackPressedDispatcher
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.offset
import androidx.compose.ui.unit.sp
import androidx.core.view.ViewCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ui.screens.AdminDashboardScreen
import com.example.ui.screens.AuthScreen
import com.example.ui.screens.ChatScreen
import com.example.ui.screens.DoctorDashboardScreen
import com.example.ui.screens.NotificationsScreen
import com.example.ui.screens.PatientDashboardScreen
import com.example.ui.screens.ProfileScreen
import com.example.ui.screens.RegistrationScreen
import com.example.ui.screens.SymptomIntakeScreen
import com.example.ui.theme.*

private val PrimaryGreenDark = Color(0xFF0D7A35)
private val Neutral200 = Color(0xFFE5E7EB)
private val NavGray = Color(0xFF9E9E9E)

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

    // ─── System Bars Styling ────────────────────────────
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val activity = view.context as Activity
            activity.window.statusBarColor = PrimaryGreenDark.toArgb()
            activity.window.navigationBarColor = Color.White.toArgb()
            val insetsController = ViewCompat.getWindowInsetsController(activity.window.decorView)
            insetsController?.isAppearanceLightStatusBars = false
            insetsController?.isAppearanceLightNavigationBars = true
        }
    }

    // ─── Call Permission Handling ────────────────────────────
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


    // Request permissions on first login
    val hasRequestedStartupPerms = remember { mutableStateOf(false) }
    LaunchedEffect(authState) {
        if (authState !is AuthState.Unauthenticated && !hasRequestedStartupPerms.value) {
            hasRequestedStartupPerms.value = true
            permissionLauncher.launch(
                arrayOf(
                    Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.CAMERA,
                    Manifest.permission.READ_MEDIA_IMAGES,
                )
            )
        }
    }

    // ─── Handle Android back button ────────────────────────────
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

    // Determine if bottom nav should be visible
    val showBottomNav = authState !is AuthState.Unauthenticated &&
            authState !is AuthState.Loading &&
            currentScreen !in listOf("auth", "chat", "register")

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(SanteBackground)
    ) {
        // Main content
        AnimatedContent(
            targetState = currentScreen,
            modifier = Modifier
                .fillMaxSize()
                .padding(bottom = if (showBottomNav) 64.dp else 0.dp),
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
                    onNavigate = { route ->
                        when (route) {
                            "home" -> currentScreen = "home"
                            "profile" -> currentScreen = "profile"
                            "notifications" -> currentScreen = "notifications"
                            "intake" -> currentScreen = "intake"
                        }
                    },
                    onBack = { currentScreen = "home" }
                )

                "profile" -> ProfileScreen(
                    viewModel = viewModel,
                    onBack = { currentScreen = "home" }
                )

                "notifications" -> NotificationsScreen(
                    onBack = { currentScreen = "home" }
                )
            }
        }

        // ─── Bottom Navigation Bar ────────────────────────────
        if (showBottomNav) {
            BottomNavBar(
                modifier = Modifier.align(Alignment.BottomCenter),
                selectedRoute = currentScreen,
                activeConsultationId = activeConsultationId,
                onSelect = { route -> currentScreen = route },
                onNewConsultation = { currentScreen = "intake" }
            )
        }

        // ZEGOCLOUD UIKit handles the call UI entirely (ringing, call screen,
        // hang-up). No custom CallScreen overlay is needed.
    }
}

// ─── Bottom Navigation Bar ──────────────────────────────────────

@Composable
private fun BottomNavBar(
    modifier: Modifier = Modifier,
    selectedRoute: String,
    activeConsultationId: String?,
    onSelect: (String) -> Unit,
    onNewConsultation: () -> Unit
) {
    Column(
        modifier = modifier.fillMaxWidth()
    ) {
        // Top border
        HorizontalDivider(color = Neutral200, thickness = 1.dp)

        // Nav bar container (no clipping so the raised + button renders above)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(64.dp)
                .background(Color.White)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Accueil
                Box(
                    modifier = Modifier.weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    NavBarItem(
                        icon = Icons.Default.Home,
                        label = "Accueil",
                        selected = selectedRoute == "home",
                        onClick = { onSelect("home") }
                    )
                }

                // Consultations
                Box(
                    modifier = Modifier.weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    NavBarItem(
                        icon = Icons.AutoMirrored.Filled.Chat,
                        label = "Messages",
                        selected = selectedRoute == "chat",
                        enabled = activeConsultationId != null,
                        onClick = { if (activeConsultationId != null) onSelect("chat") }
                    )
                }

                // Center spacer for the raised + button
                Box(modifier = Modifier.weight(1f))

                // Notifications
                Box(
                    modifier = Modifier.weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    NavBarItem(
                        icon = Icons.Default.Settings,
                        label = "Alertes",
                        selected = selectedRoute == "notifications",
                        onClick = { onSelect("notifications") }
                    )
                }

                // Profil
                Box(
                    modifier = Modifier.weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    NavBarItem(
                        icon = Icons.Default.Person,
                        label = "Profil",
                        selected = selectedRoute == "profile",
                        onClick = { onSelect("profile") }
                    )
                }
            }

            // Raised center + button (overlaid, raised 12dp above the bar)
            Box(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .offset(y = (-12).dp)
                    .size(48.dp)
                    .shadow(6.dp, CircleShape)
                    .background(PrimaryGreen, CircleShape)
                    .clickable { onNewConsultation() },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Add,
                    contentDescription = "Nouvelle consultation",
                    tint = Color.White,
                    modifier = Modifier.size(24.dp)
                )
            }
        }
    }
}

// ─── Nav Bar Item ─────────────────────────────────────────

@Composable
private fun NavBarItem(
    icon: ImageVector,
    label: String,
    selected: Boolean,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    val contentColor = if (selected) PrimaryGreen else NavGray

    Column(
        modifier = Modifier
            .width(64.dp)
            .clickable(enabled = enabled) { onClick() },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Small green dot indicator above icon when selected
        if (selected) {
            Box(
                modifier = Modifier
                    .size(4.dp)
                    .background(PrimaryGreen, CircleShape)
            )
            Spacer(modifier = Modifier.height(4.dp))
        } else {
            Spacer(modifier = Modifier.height(8.dp))
        }

        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = if (enabled) contentColor else NavGray.copy(alpha = 0.4f),
            modifier = Modifier.size(24.dp)
        )

        Spacer(modifier = Modifier.height(2.dp))

        Text(
            text = label,
            fontSize = 11.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (enabled) contentColor else NavGray.copy(alpha = 0.4f)
        )
    }
}
