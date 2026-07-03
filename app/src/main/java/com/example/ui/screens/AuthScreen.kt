package com.example.ui.screens

import androidx.compose.ui.res.painterResource

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.R
import com.example.ui.AuthState
import com.example.ui.SanteViewModel
import com.example.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthScreen(
    viewModel: SanteViewModel,
    onNavigateToRegister: () -> Unit = {}
) {
    val authState by viewModel.authState.collectAsStateWithLifecycle()
    val loginError by viewModel.loginError.collectAsStateWithLifecycle()

    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }

    val isLoading = authState is AuthState.Loading

    val configuration = LocalConfiguration.current
    val screenHeight = configuration.screenHeightDp.dp

    // ── Floating orb animations ──────────────────────────────────────
    val infiniteTransition = rememberInfiniteTransition(label = "bg-orbs")
    val orbOffset1 by infiniteTransition.animateFloat(
        initialValue = -15f,
        targetValue = 15f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 7000, easing = { it }),
            repeatMode = RepeatMode.Reverse
        ),
        label = "orb1"
    )
    val orbOffset2 by infiniteTransition.animateFloat(
        initialValue = 12f,
        targetValue = -10f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 9000, delayMillis = 1200, easing = { it }),
            repeatMode = RepeatMode.Reverse
        ),
        label = "orb2"
    )
    val orbOffset3 by infiniteTransition.animateFloat(
        initialValue = -8f,
        targetValue = 18f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 8000, delayMillis = 2400, easing = { it }),
            repeatMode = RepeatMode.Reverse
        ),
        label = "orb3"
    )
    val orbAlpha by infiniteTransition.animateFloat(
        initialValue = 0.08f,
        targetValue = 0.18f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 5000, delayMillis = 500, easing = { it }),
            repeatMode = RepeatMode.Reverse
        ),
        label = "orb-alpha"
    )

    // ── Main container ───────────────────────────────────────────────
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
    ) {
        // ── Top green gradient wash ──────────────────────────────────
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(320.dp)
                .background(
                    brush = Brush.verticalGradient(
                        colors = listOf(
                            PrimaryGreen.copy(alpha = 0.06f),
                            Green50.copy(alpha = 0.03f),
                            Color.Transparent
                        ),
                        endY = 600f
                    )
                )
        )

        // ── Subtle floating orbs ─────────────────────────────────────
        Box(
            modifier = Modifier
                .size(180.dp)
                .offset(x = (-50).dp, y = (-30).dp + orbOffset1.dp)
                .background(
                    color = PrimaryGreen.copy(alpha = orbAlpha * 0.6f),
                    shape = CircleShape
                )
                .alpha(orbAlpha)
        )
        Box(
            modifier = Modifier
                .size(140.dp)
                .offset(x = 260.dp, y = 120.dp + orbOffset2.dp)
                .background(
                    color = Green200.copy(alpha = orbAlpha * 0.5f),
                    shape = CircleShape
                )
                .alpha(orbAlpha * 0.8f)
        )
        Box(
            modifier = Modifier
                .size(120.dp)
                .offset(x = 20.dp, y = 520.dp + orbOffset3.dp)
                .background(
                    color = Green100.copy(alpha = orbAlpha * 0.4f),
                    shape = CircleShape
                )
                .alpha(orbAlpha * 0.6f)
        )

        // ── Scrollable content ───────────────────────────────────────
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(top = 56.dp, bottom = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {

            // ── Logo ─────────────────────────────────────────────────
            Image(
                painter = painterResource(R.drawable.medika_logo_header),
                contentDescription = "Medika",
                modifier = Modifier.size(100.dp),
                contentScale = ContentScale.Fit
            )

            Spacer(modifier = Modifier.height(16.dp))

            // ── App name ─────────────────────────────────────────────
            Text(
                text = "Medika",
                fontSize = 38.sp,
                fontWeight = FontWeight.ExtraBold,
                color = PrimaryGreen,
                letterSpacing = 1.sp
            )

            Spacer(modifier = Modifier.height(6.dp))

            // ── Tagline ──────────────────────────────────────────────
            Text(
                text = buildAnnotatedString {
                    withStyle(style = SpanStyle(fontWeight = FontWeight.SemiBold)) {
                        append("SOINS.")
                    }
                    append("  PARTOUT.  ")
                    withStyle(style = SpanStyle(fontWeight = FontWeight.SemiBold)) {
                        append("POUR TOUS.")
                    }
                },
                fontSize = 13.sp,
                color = Green700,
                letterSpacing = 2.sp,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(44.dp))

            // ── Login card ───────────────────────────────────────────
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(
                        elevation = 8.dp,
                        shape = RoundedCornerShape(20.dp),
                        ambientColor = Color(0xFF1B5E20).copy(alpha = 0.08f),
                        spotColor = Color(0xFF1B5E20).copy(alpha = 0.06f)
                    ),
                shape = RoundedCornerShape(20.dp),
                color = Color.White,
                border = BorderStroke(1.dp, Green100.copy(alpha = 0.5f))
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(28.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp)
                ) {
                    // Card header
                    Text(
                        text = "Connexion",
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary,
                        fontFamily = FontFamily.SansSerif
                    )

                    Text(
                        text = "Acc\u00e9dez \u00e0 votre espace de sant\u00e9",
                        fontSize = 14.sp,
                        color = TextSecondary,
                        fontWeight = FontWeight.Normal
                    )

                    Spacer(modifier = Modifier.height(4.dp))

                    // ── Username field ────────────────────────────────
                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it; viewModel.clearLoginError() },
                        placeholder = {
                            Text(
                                "Nom d\u2019utilisateur ou email",
                                color = Green400.copy(alpha = 0.6f),
                                fontSize = 15.sp
                            )
                        },
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(58.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = PrimaryGreen,
                            focusedLabelColor = PrimaryGreen,
                            cursorColor = PrimaryGreen,
                            unfocusedBorderColor = Green200.copy(alpha = 0.7f),
                            unfocusedContainerColor = Green50.copy(alpha = 0.15f),
                            focusedContainerColor = Color.White,
                            disabledContainerColor = Green50.copy(alpha = 0.08f)
                        ),
                        shape = RoundedCornerShape(16.dp),
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.Email,
                                contentDescription = null,
                                tint = Green500,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    )

                    // ── Password field ────────────────────────────────
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        placeholder = {
                            Text(
                                "Mot de passe",
                                color = Green400.copy(alpha = 0.6f),
                                fontSize = 15.sp
                            )
                        },
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(58.dp),
                        visualTransformation = if (passwordVisible) {
                            VisualTransformation.None
                        } else {
                            PasswordVisualTransformation()
                        },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = PrimaryGreen,
                            focusedLabelColor = PrimaryGreen,
                            cursorColor = PrimaryGreen,
                            unfocusedBorderColor = Green200.copy(alpha = 0.7f),
                            unfocusedContainerColor = Green50.copy(alpha = 0.15f),
                            focusedContainerColor = Color.White,
                            disabledContainerColor = Green50.copy(alpha = 0.08f)
                        ),
                        shape = RoundedCornerShape(16.dp),
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.Lock,
                                contentDescription = null,
                                tint = Green500,
                                modifier = Modifier.size(20.dp)
                            )
                        },
                        trailingIcon = {
                            IconButton(
                                onClick = { passwordVisible = !passwordVisible },
                                modifier = Modifier.size(40.dp)
                            ) {
                                Icon(
                                    imageVector = if (passwordVisible) {
                                        Icons.Default.VisibilityOff
                                    } else {
                                        Icons.Default.Visibility
                                    },
                                    contentDescription = if (passwordVisible) "Cacher" else "Montrer",
                                    tint = Green500,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                    )

                    // ── Error display ─────────────────────────────────
                    if (loginError != null) {
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            color = SanteDanger.copy(alpha = 0.08f),
                            border = BorderStroke(1.dp, SanteDanger.copy(alpha = 0.15f))
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(8.dp)
                                        .background(SanteDanger, CircleShape)
                                )
                                Spacer(modifier = Modifier.width(12.dp))
                                Text(
                                    text = loginError ?: "",
                                    color = SanteDanger,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Medium,
                                    lineHeight = 20.sp
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(4.dp))

                    // ── Login button ──────────────────────────────────
                    Button(
                        onClick = {
                            if (username.isNotBlank() && password.isNotBlank()) {
                                viewModel.loginWithCredentials(username, password)
                            }
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        enabled = !isLoading
                            && username.isNotBlank()
                            && password.isNotBlank(),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = PrimaryGreen,
                            contentColor = Color.White,
                            disabledContainerColor = Green200.copy(alpha = 0.5f),
                            disabledContentColor = Color.White.copy(alpha = 0.6f)
                        ),
                        elevation = ButtonDefaults.buttonElevation(
                            defaultElevation = 4.dp,
                            pressedElevation = 2.dp,
                            disabledElevation = 0.dp
                        )
                    ) {
                        if (isLoading) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center
                            ) {
                                CircularProgressIndicator(
                                    color = Color.White,
                                    strokeWidth = 2.5.dp,
                                    modifier = Modifier.size(22.dp)
                                )
                                Spacer(modifier = Modifier.width(12.dp))
                                Text(
                                    text = "Connexion en cours\u2026",
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        } else {
                            Text(
                                text = "Se connecter",
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold,
                                letterSpacing = 0.5.sp
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            // ── Register link ────────────────────────────────────────
            TextButton(
                onClick = onNavigateToRegister,
                modifier = Modifier.height(48.dp)
            ) {
                Text(
                    text = "Pas de compte ? ",
                    color = TextSecondary,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Normal
                )
                Text(
                    text = "Cr\u00e9er un compte",
                    color = PrimaryGreen,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // ── Secure connection badge ──────────────────────────────
            Surface(
                shape = RoundedCornerShape(24.dp),
                color = Green50.copy(alpha = 0.7f),
                border = BorderStroke(1.dp, Green100.copy(alpha = 0.4f))
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Lock,
                        contentDescription = null,
                        tint = Green500,
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Connexion s\u00e9curis\u00e9e \u00b7 Chiffrement TLS",
                        fontSize = 12.sp,
                        color = Green700,
                        fontWeight = FontWeight.Medium,
                        letterSpacing = 0.3.sp
                    )
                }
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}
