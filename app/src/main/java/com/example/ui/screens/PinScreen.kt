package com.example.ui.screens

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.repeatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Backspace
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.R
import com.example.ui.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ═══════════════════════════════════════════════════════════════════════════
// PIN SETUP — Shown after first successful login
// ═══════════════════════════════════════════════════════════════════════════

@Composable
fun PinSetupScreen(
    onPinCreated: (String) -> Unit,
    onSkip: (() -> Unit)? = null
) {
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    var step by remember { mutableStateOf(1) }
    var firstPin by remember { mutableStateOf("") }
    var currentPin by remember { mutableStateOf("") }
    var showError by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf("") }
    var successAnimation by remember { mutableStateOf(false) }

    val shakeX = remember { Animatable(0f) }

    LaunchedEffect(showError) {
        if (showError) {
            shakeX.snapTo(-14f)
            shakeX.animateTo(0f, spring(dampingRatio = 0.25f, stiffness = 280f))
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            delay(500)
            showError = false
        }
    }

    LaunchedEffect(successAnimation) {
        if (successAnimation) {
            delay(600)
            onPinCreated(firstPin)
        }
    }

    PinScreenScaffold(
        title = if (step == 1) "Cr\u00e9ez votre code PIN" else "Confirmez votre code PIN",
        subtitle = if (step == 1)
            "Ce code \u00e0 4 chiffres sera demand\u00e9 \u00e0 chaque ouverture de l\u2019application pour prot\u00e9ger votre compte."
        else
            "Retapez votre code PIN pour le confirmer.",
        currentPin = currentPin,
        isError = showError,
        errorMessage = errorMessage,
        isSuccess = successAnimation,
        shakeX = shakeX,
        onDigit = { digit ->
            if (showError || successAnimation) return@PinScreenScaffold
            if (currentPin.length >= 4) return@PinScreenScaffold
            currentPin += digit
            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)

            if (currentPin.length == 4) {
                scope.launch {
                    delay(250)
                    if (step == 1) {
                        firstPin = currentPin
                        currentPin = ""
                        step = 2
                    } else {
                        if (currentPin == firstPin) {
                            successAnimation = true
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        } else {
                            errorMessage = "Les codes PIN ne correspondent pas. R\u00e9essayez."
                            showError = true
                            currentPin = ""
                            step = 1
                            firstPin = ""
                        }
                    }
                }
            }
        },
        onDelete = {
            if (currentPin.isNotEmpty()) {
                currentPin = currentPin.dropLast(1)
                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            }
        },
        footerContent = {
            if (onSkip != null) {
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "Configurer plus tard",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    color = TextTertiary,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .pointerInput(onSkip) { detectTapGestures { onSkip() } }
                        .padding(horizontal = 20.dp, vertical = 10.dp)
                )
            }
        }
    )
}

// ═══════════════════════════════════════════════════════════════════════════
// PIN VERIFY — Shown on app reopen when a PIN is set
// ═══════════════════════════════════════════════════════════════════════════

@Composable
fun PinVerifyScreen(
    onPinEntered: (String) -> Unit,
    onLogout: () -> Unit,
    errorFlow: String?,
    onErrorConsumed: () -> Unit
) {
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    var currentPin by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf("") }
    var showError by remember { mutableStateOf(false) }
    var attemptsRemaining by remember { mutableIntStateOf(5) }
    var isLockedOut by remember { mutableStateOf(false) }
    var lockoutSeconds by remember { mutableIntStateOf(0) }

    val shakeX = remember { Animatable(0f) }

    LaunchedEffect(errorFlow) {
        if (errorFlow != null) {
            attemptsRemaining--
            localError = if (attemptsRemaining > 0) {
                "Code incorrect. $attemptsRemaining tentative${if (attemptsRemaining > 1) "s" else ""} restante${if (attemptsRemaining > 1) "s" else ""}."
            } else {
                "Trop de tentatives. Veuillez r\u00e9essayer plus tard."
            }
            showError = true
            shakeX.snapTo(-14f)
            shakeX.animateTo(0f, spring(dampingRatio = 0.25f, stiffness = 280f))
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            currentPin = ""

            if (attemptsRemaining <= 0) {
                isLockedOut = true
                lockoutSeconds = 30
            }
            onErrorConsumed()
        }
    }

    LaunchedEffect(isLockedOut, lockoutSeconds) {
        if (isLockedOut && lockoutSeconds > 0) {
            delay(1000)
            lockoutSeconds--
            if (lockoutSeconds == 0) {
                isLockedOut = false
                attemptsRemaining = 5
            }
        }
    }

    LaunchedEffect(showError) {
        if (showError) {
            delay(500)
            showError = false
        }
    }

    PinScreenScaffold(
        title = "Saisissez votre code PIN",
        subtitle = "Entrez votre code de s\u00e9curit\u00e9 pour acc\u00e9der \u00e0 Medika.",
        currentPin = currentPin,
        isError = showError,
        errorMessage = localError,
        isSuccess = false,
        shakeX = shakeX,
        isLockedOut = isLockedOut,
        lockoutSeconds = lockoutSeconds,
        onDigit = { digit ->
            if (showError || isLockedOut) return@PinScreenScaffold
            if (currentPin.length >= 4) return@PinScreenScaffold
            currentPin += digit
            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)

            if (currentPin.length == 4) {
                scope.launch {
                    delay(250)
                    if (!isLockedOut && attemptsRemaining > 0) {
                        onPinEntered(currentPin)
                    }
                }
            }
        },
        onDelete = {
            if (currentPin.isNotEmpty()) {
                currentPin = currentPin.dropLast(1)
                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            }
        },
        footerContent = {
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "Se d\u00e9connecter",
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = TextTertiary,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .pointerInput(onLogout) { detectTapGestures { onLogout() } }
                    .padding(horizontal = 20.dp, vertical = 10.dp)
            )
        }
    )
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED SCAFFOLD
// ═══════════════════════════════════════════════════════════════════════════

@Composable
private fun PinScreenScaffold(
    title: String,
    subtitle: String,
    currentPin: String,
    isError: Boolean,
    errorMessage: String,
    isSuccess: Boolean,
    shakeX: Animatable<Float, *>,
    isLockedOut: Boolean = false,
    lockoutSeconds: Int = 0,
    onDigit: (String) -> Unit,
    onDelete: () -> Unit,
    footerContent: @Composable () -> Unit = {}
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
    ) {
        // Top gradient
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(300.dp)
                .background(
                    brush = Brush.verticalGradient(
                        colors = listOf(
                            PrimaryGreenDark,
                            PrimaryGreen,
                            Green300.copy(alpha = 0.35f),
                            Color.Transparent
                        ),
                        endY = 750f
                    )
                )
        )

        // Decorative circles
        Box(
            modifier = Modifier
                .size(220.dp)
                .offset(x = (-90).dp, y = (-70).dp)
                .background(PrimaryGreenLight.copy(alpha = 0.07f), CircleShape)
        )
        Box(
            modifier = Modifier
                .size(160.dp)
                .offset(x = 280.dp, y = 110.dp)
                .background(Green200.copy(alpha = 0.06f), CircleShape)
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(80.dp))

            // Logo
            Image(
                painter = painterResource(R.drawable.medika_logo_header),
                contentDescription = "Medika",
                modifier = Modifier.size(68.dp),
                contentScale = ContentScale.Fit
            )

            Spacer(modifier = Modifier.height(20.dp))

            // Title
            Text(
                text = title,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                color = PrimaryGreenDark,
                textAlign = TextAlign.Center,
                letterSpacing = 0.2.sp
            )

            Spacer(modifier = Modifier.height(10.dp))

            // Subtitle
            Text(
                text = subtitle,
                fontSize = 14.sp,
                fontWeight = FontWeight.Normal,
                color = TextSecondary,
                textAlign = TextAlign.Center,
                lineHeight = 22.sp,
                modifier = Modifier.padding(horizontal = 12.dp)
            )

            Spacer(modifier = Modifier.height(52.dp))

            // PIN dots
            PinDotRow(
                filledCount = currentPin.length,
                isError = isError,
                isSuccess = isSuccess,
                shakeX = shakeX
            )

            Spacer(modifier = Modifier.height(20.dp))

            // Error banner
            if (isError && errorMessage.isNotEmpty()) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = SanteDanger.copy(alpha = 0.07f),
                    border = BorderStroke(1.dp, SanteDanger.copy(alpha = 0.15f))
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .background(SanteDanger, CircleShape)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = errorMessage,
                            color = SanteDanger,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            } else if (isSuccess) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = SanteSuccess.copy(alpha = 0.07f),
                    border = BorderStroke(1.dp, SanteSuccess.copy(alpha = 0.15f))
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .background(SanteSuccess, CircleShape)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = "Code PIN configur\u00e9 avec succ\u00e8s",
                            color = SanteSuccess,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }

            // Lockout timer
            if (isLockedOut && lockoutSeconds > 0) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = "R\u00e9essayez dans ${lockoutSeconds}s",
                    fontSize = 14.sp,
                    color = TextTertiary,
                    fontWeight = FontWeight.Medium
                )
            }

            Spacer(modifier = Modifier.weight(1f))

            // Number pad
            PinNumberPad(
                onDigit = onDigit,
                onDelete = onDelete,
                enabled = !isLockedOut
            )

            // Footer
            footerContent()

            Spacer(modifier = Modifier.height(28.dp))
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PIN DOT ROW
// ═══════════════════════════════════════════════════════════════════════════

@Composable
private fun PinDotRow(
    filledCount: Int,
    isError: Boolean,
    isSuccess: Boolean,
    shakeX: Animatable<Float, *>
) {
    // Pulse alpha for success animation
    var pulsePhase by remember { mutableStateOf(false) }
    LaunchedEffect(isSuccess) {
        if (isSuccess) {
            while (true) {
                pulsePhase = !pulsePhase
                delay(300)
            }
        }
    }
    val pulseAlpha by animateFloatAsState(
        targetValue = if (isSuccess && pulsePhase) 0.7f else 0f,
        animationSpec = tween(300),
        label = "pulse"
    )

    Row(
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.offset(x = shakeX.value.dp)
    ) {
        repeat(4) { index ->
            val filled = index < filledCount
            val active = index == filledCount

            val scale by animateFloatAsState(
                targetValue = when {
                    isSuccess -> 1f
                    active -> 1.05f
                    else -> 1f
                },
                animationSpec = spring(dampingRatio = 0.5f, stiffness = 350f),
                label = "dot_scale_$index"
            )

            val borderColor by animateColorAsState(
                targetValue = when {
                    isError -> SanteDanger.copy(alpha = 0.6f)
                    isSuccess -> SanteSuccess
                    filled -> PrimaryGreen
                    active -> Green300
                    else -> Neutral200
                },
                animationSpec = tween(200),
                label = "dot_border_$index"
            )

            val innerColor by animateColorAsState(
                targetValue = when {
                    isError && filled -> SanteDanger
                    isSuccess -> SanteSuccess.copy(alpha = 0.6f + pulseAlpha)
                    filled -> PrimaryGreen
                    else -> Color.Transparent
                },
                animationSpec = tween(200),
                label = "dot_inner_$index"
            )

            val bgColor by animateColorAsState(
                targetValue = if (filled) PrimaryGreen.copy(alpha = 0.1f) else Color.Transparent,
                animationSpec = tween(200),
                label = "dot_bg_$index"
            )

            val dotSize by animateDpAsState(
                targetValue = if (filled) 20.dp else 10.dp,
                animationSpec = spring(dampingRatio = 0.5f, stiffness = 350f),
                label = "dot_size_$index"
            )

            Box(
                modifier = Modifier
                    .size(58.dp)
                    .scale(scale)
                    .border(
                        width = if (filled) 0.dp else 2.dp,
                        color = borderColor,
                        shape = RoundedCornerShape(16.dp)
                    )
                    .background(bgColor, RoundedCornerShape(16.dp)),
                contentAlignment = Alignment.Center
            ) {
                Box(
                    modifier = Modifier
                        .size(dotSize)
                        .background(innerColor, CircleShape)
                )
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// NUMBER PAD
// ═══════════════════════════════════════════════════════════════════════════

@Composable
private fun PinNumberPad(
    onDigit: (String) -> Unit,
    onDelete: () -> Unit,
    enabled: Boolean = true
) {
    val haptic = LocalHapticFeedback.current

    val keys = listOf(
        listOf("1", "2", "3"),
        listOf("4", "5", "6"),
        listOf("7", "8", "9"),
        listOf("", "0", "delete")
    )

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        keys.forEach { row ->
            Row(
                horizontalArrangement = Arrangement.spacedBy(28.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                row.forEach { key ->
                    when {
                        key.isEmpty() -> {
                            Box(modifier = Modifier.size(72.dp))
                        }
                        key == "delete" -> {
                            Box(
                                modifier = Modifier
                                    .size(72.dp)
                                    .clip(CircleShape)
                                    .background(Neutral50, CircleShape)
                                    .border(1.dp, Neutral200, CircleShape)
                                    .then(
                                        if (enabled) {
                                            Modifier.pointerInput("del") {
                                                detectTapGestures {
                                                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                                    onDelete()
                                                }
                                            }
                                        } else Modifier
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Backspace,
                                    contentDescription = "Supprimer",
                                    tint = if (enabled) TextSecondary else TextTertiary.copy(alpha = 0.3f),
                                    modifier = Modifier.size(24.dp)
                                )
                            }
                        }
                        else -> {
                            var pressed by remember { mutableStateOf(false) }
                            val scale by animateFloatAsState(
                                targetValue = if (pressed) 0.88f else 1f,
                                animationSpec = spring(dampingRatio = 0.35f, stiffness = 450f),
                                label = "key_$key"
                            )

                            Box(
                                modifier = Modifier
                                    .size(72.dp)
                                    .scale(scale)
                                    .clip(CircleShape)
                                    .background(
                                        if (enabled) Color.White else Neutral100,
                                        CircleShape
                                    )
                                    .border(1.dp, if (enabled) Neutral200 else Neutral100, CircleShape)
                                    .then(
                                        if (enabled) {
                                            Modifier.pointerInput(key) {
                                                detectTapGestures {
                                                    pressed = true
                                                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                                    onDigit(key)
                                                    // Reset pressed after animation
                                                    kotlinx.coroutines.GlobalScope.launch {
                                                        delay(120)
                                                        pressed = false
                                                    }
                                                }
                                            }
                                        } else Modifier
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = key,
                                    fontSize = 28.sp,
                                    fontWeight = FontWeight.Light,
                                    color = if (enabled) TextPrimary else TextTertiary.copy(alpha = 0.3f)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}