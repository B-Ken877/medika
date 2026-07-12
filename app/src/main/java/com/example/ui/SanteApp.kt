package com.example.ui

import android.app.Activity
import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
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
import com.example.ui.screens.TicketListScreen
import com.example.ui.screens.TicketChatScreen
import com.example.ui.screens.ConsultationHistoryScreen
import com.example.ui.screens.PatientDashboardScreen
import com.example.ui.screens.PinSetupScreen
import com.example.ui.screens.PinVerifyScreen
import com.example.ui.screens.ProfileScreen
import com.example.ui.screens.RegistrationScreen
import com.example.ui.screens.SymptomIntakeScreen
import com.example.R
import com.example.ui.theme.*
import android.widget.Toast
import android.net.Uri
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.ui.draw.clip

private val PrimaryGreenDark = Color(0xFF0D7A35)
private val Neutral200 = Color(0xFFE5E7EB)
private val NavGray = Color(0xFF9E9E9E)

private val screenOrder = listOf("loading", "auth", "register", "pin_setup", "pin_verify", "home", "intake", "chat", "profile", "notifications", "consultation_history", "ticket_list", "ticket_chat")

// Navigation history for back button support
private val screenBackMap = mapOf(
    "register" to "auth",
    "pin_setup" to "auth",
    "pin_verify" to "auth",
    "intake" to "home",
    "chat" to "home",
    "profile" to "home",
    "notifications" to "home",
    "ticket_list" to "home",
    "ticket_chat" to "ticket_list",
    "consultation_history" to "home"
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

    // ─── PIN State Observation ────────────────────────────
    val needsPinSetup by viewModel.needsPinSetup.collectAsStateWithLifecycle()
    val needsPinVerify by viewModel.needsPinVerify.collectAsStateWithLifecycle()
    val pinVerifyError by viewModel.pinVerifyError.collectAsStateWithLifecycle()


    var currentScreen by remember { mutableStateOf("loading") }

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

    // ─── Permission Handling ────────────────────────────
    val isPermissionRequestInProgress = remember { mutableStateOf(false) }
    val requestCallPerms by viewModel.requestCallPermissions.collectAsStateWithLifecycle()
    val requestMicPerm by viewModel.requestMicPermission.collectAsStateWithLifecycle()
    val requestStoragePerm by viewModel.requestStoragePermission.collectAsStateWithLifecycle()

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { perms ->
        isPermissionRequestInProgress.value = false
        val granted = perms.values.all { it }
        if (viewModel.pendingIncomingCall != null) {
            viewModel.onIncomingCallPermissionsResult(granted)
        } else {
            viewModel.onCallPermissionsResult(granted)
        }
    }

    LaunchedEffect(requestCallPerms) {
        if (requestCallPerms && !isPermissionRequestInProgress.value) {
            isPermissionRequestInProgress.value = true
            val perms = mutableListOf(Manifest.permission.RECORD_AUDIO)
            if (viewModel.pendingCallNeedsVideo) perms.add(Manifest.permission.CAMERA)
            permissionLauncher.launch(perms.toTypedArray())
        }
    }

    // Mic permission for voice recording
    val micPermLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        viewModel.onMicPermissionResult(granted)
    }

    LaunchedEffect(requestMicPerm) {
        if (requestMicPerm) {
            micPermLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    // Storage permission for media
    val storagePermLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        viewModel.onStoragePermissionResult(granted)
    }

    LaunchedEffect(requestStoragePerm) {
        if (requestStoragePerm) {
            val perm = if (android.os.Build.VERSION.SDK_INT >= 33) {
                Manifest.permission.READ_MEDIA_IMAGES
            } else {
                Manifest.permission.READ_EXTERNAL_STORAGE
            }
            storagePermLauncher.launch(perm)
        }
    }

    // Request permissions on first login
    val hasRequestedStartupPerms = remember { mutableStateOf(false) }
    LaunchedEffect(authState) {
        if (authState !is AuthState.Unauthenticated && !hasRequestedStartupPerms.value && !isPermissionRequestInProgress.value) {
            hasRequestedStartupPerms.value = true
            isPermissionRequestInProgress.value = true
            val storagePerm = if (android.os.Build.VERSION.SDK_INT >= 33) {
                Manifest.permission.READ_MEDIA_IMAGES
            } else {
                Manifest.permission.READ_EXTERNAL_STORAGE
            }
            permissionLauncher.launch(
                arrayOf(
                    Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.CAMERA,
                    storagePerm,
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
                } else {
                    // On home, auth, loading screens — let system handle (exit app)
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
            is AuthState.Loading -> {
                // Show loading screen while restoring session
                if (currentScreen == "auth") currentScreen = "loading"
            }
            is AuthState.Unauthenticated -> currentScreen = "auth"
            is AuthState.PatientAuthenticated,
            is AuthState.DoctorAuthenticated,
            is AuthState.AdminAuthenticated -> {
                if (currentScreen == "auth" || currentScreen == "register" || currentScreen == "loading") {
                    if (needsPinSetup) {
                        currentScreen = "pin_setup"
                    } else if (needsPinVerify) {
                        currentScreen = "pin_verify"
                    } else {
                        currentScreen = "home"
                    }
                }
            }
            else -> {}
        }
    }

    // React to PIN setup dismissal -> go to home
    LaunchedEffect(needsPinSetup) {
        if (!needsPinSetup && currentScreen == "pin_setup" && authState !is AuthState.Unauthenticated) {
            currentScreen = "home"
        }
    }

    // React to PIN verification -> go to home
    LaunchedEffect(needsPinVerify) {
        if (!needsPinVerify && currentScreen == "pin_verify") {
            currentScreen = "home"
        }
    }

    // Determine if bottom nav should be visible
    val showBottomNav = authState !is AuthState.Unauthenticated &&
            authState !is AuthState.Loading &&
            currentScreen !in listOf("auth", "chat", "register", "pin_setup", "pin_verify", "loading")

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
                "loading" -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Image(
                            painter = painterResource(R.drawable.medika_logo_splash),
                            contentDescription = "Medika",
                            modifier = Modifier.size(180.dp),
                            contentScale = ContentScale.Fit
                        )
                    }
                }

                "auth" -> AuthScreen(
                    viewModel = viewModel,
                    onNavigateToRegister = { currentScreen = "register" }
                )

                "register" -> RegistrationScreen(
                    viewModel = viewModel,
                    onBack = { currentScreen = "auth" }
                )

                "pin_setup" -> PinSetupScreen(
                    onPinCreated = { pin ->
                        viewModel.setPin(pin)
                    },
                    onSkip = {
                        viewModel.skipPinSetup()
                    }
                )

                "pin_verify" -> PinVerifyScreen(
                    onPinEntered = { pin ->
                        viewModel.verifyPin(pin)
                    },
                    onLogout = {
                        viewModel.logout()
                        currentScreen = "auth"
                    },
                    errorFlow = pinVerifyError,
                    onErrorConsumed = { viewModel.consumePinError() }
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
                                "consultation_history" -> currentScreen = "consultation_history"
                                "ticket_list" -> currentScreen = "ticket_list"
                            }
                        }
                    )
                    is AuthState.DoctorAuthenticated -> DoctorDashboardScreen(
                        viewModel = viewModel,
                        onNavigate = { route ->
                            when (route) {
                                "chat" -> currentScreen = "chat"
                                "notifications" -> currentScreen = "notifications"
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
                    viewModel = viewModel,
                    onNavigate = { route ->
                        when (route) {
                            "chat" -> currentScreen = "chat"
                        }
                    },
                    onBack = { currentScreen = "home" }
                )

                "ticket_list" -> TicketListScreen(
                    viewModel = viewModel,
                    onNavigate = { route -> currentScreen = route },
                    onBack = { currentScreen = "home" }
                )
                "ticket_chat" -> TicketChatScreen(
                    viewModel = viewModel,
                    onBack = { currentScreen = "ticket_list" }
                )
                "consultation_history" -> ConsultationHistoryScreen(
                    viewModel = viewModel,
                    onBack = { currentScreen = "home" },
                    onConsultationClick = { id ->
                        viewModel.setActiveConsultation(id)
                        currentScreen = "chat"
                    }
                )
            }
        }

        // ─── First-time login avatar prompt ────────────────────
        val serverUser = when (val auth = authState) {
            is AuthState.PatientAuthenticated -> auth.serverUser
            is AuthState.DoctorAuthenticated -> auth.serverUser
            else -> null
        }
        val hasNoAvatar = serverUser?.avatar_url == null
        val context = LocalContext.current
        var showAvatarPrompt by remember { mutableStateOf(false) }
        var isUploadingAvatar by remember { mutableStateOf(false) }

        // Show avatar prompt when ViewModel signals no avatar on auth
        LaunchedEffect(currentScreen, viewModel.shouldPromptAvatar) {
            if (currentScreen == "home" && viewModel.shouldPromptAvatar) {
                kotlinx.coroutines.delay(1000)
                showAvatarPrompt = true
                viewModel.shouldPromptAvatar = false
            }
        }

        val avatarLauncher = rememberLauncherForActivityResult(
            ActivityResultContracts.GetContent()
        ) { uri: Uri? ->
            showAvatarPrompt = false
            if (uri != null) {
                isUploadingAvatar = true
                viewModel.uploadProfilePicture(uri, context) { success, error ->
                    isUploadingAvatar = false
                    if (success) {
                        Toast.makeText(context, "Photo ajout\u00e9e!", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(context, "Erreur: ${error ?: "inconnue"}", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }

        if (showAvatarPrompt) {
            AlertDialog(
                onDismissRequest = { showAvatarPrompt = false },
                title = {
                    Text("Ajoutez votre photo de profil", fontWeight = FontWeight.Bold)
                },
                text = {
                    Text("Personnalisez votre profil en ajoutant une photo. Cela aidera les m\u00e9decins \u00e0 vous identifier.")
                },
                confirmButton = {
                    TextButton(onClick = { avatarLauncher.launch("image/*") }) {
                        Text("Choisir une photo", color = PrimaryGreen, fontWeight = FontWeight.SemiBold)
                    }
                },
                dismissButton = {
                    OutlinedButton(onClick = { showAvatarPrompt = false }) {
                        Text("Plus tard", color = Color.Gray)
                    }
                },
                shape = RoundedCornerShape(16.dp)
            )
        }

        // ─── Bottom Navigation Bar ────────────────────────────
        if (showBottomNav) {
            val isDoctor = authState is AuthState.DoctorAuthenticated
            BottomNavBar(
                modifier = Modifier.align(Alignment.BottomCenter),
                selectedRoute = currentScreen,
                activeConsultationId = activeConsultationId,
                showNewConsultationButton = !isDoctor,
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
    showNewConsultationButton: Boolean = true,
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
                Box(modifier = Modifier.weight(if (showNewConsultationButton) 1f else 0.5f))

                // Notifications
                Box(
                    modifier = Modifier.weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    NavBarItem(
                        icon = Icons.Default.Notifications,
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

            // Raised center + button (only for patients)
            if (showNewConsultationButton) {
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
