package com.example.ui.screens

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Phone
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
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
import com.example.ui.AuthState
import com.example.ui.SanteViewModel
import com.example.ui.theme.*

// ─────────────────────────────────────────────────────────────────────
// RegistrationScreen – Professional medical app onboarding
// ─────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RegistrationScreen(
    viewModel: SanteViewModel,
    onBack: () -> Unit = {},
    onRegisterSuccess: () -> Unit = {}
) {
    val authState by viewModel.authState.collectAsStateWithLifecycle()
    val registerError by viewModel.registerError.collectAsStateWithLifecycle()

    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("509") }
    var ageText by remember { mutableStateOf("") }
    var selectedGender by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var confirmPasswordVisible by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }

    val isLoading = authState is AuthState.Loading

    // ── Floating orb animations (matching AuthScreen) ────────────────
    val infiniteTransition = rememberInfiniteTransition(label = "reg-orbs")
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
    val orbAlpha by infiniteTransition.animateFloat(
        initialValue = 0.08f,
        targetValue = 0.18f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 5000, delayMillis = 500, easing = { it }),
            repeatMode = RepeatMode.Reverse
        ),
        label = "orb-alpha"
    )

    // ── Navigate on success ──────────────────────────────────────────
    LaunchedEffect(authState) {
        if (authState is AuthState.PatientAuthenticated && registerError == null) {
            onRegisterSuccess()
        }
    }

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
                .size(160.dp)
                .offset(x = (-60).dp, y = (-20).dp + orbOffset1.dp)
                .background(
                    color = PrimaryGreen.copy(alpha = orbAlpha * 0.6f),
                    shape = CircleShape
                )
                .alpha(orbAlpha)
        )
        Box(
            modifier = Modifier
                .size(120.dp)
                .offset(x = 280.dp, y = 100.dp + orbOffset2.dp)
                .background(
                    color = Green200.copy(alpha = orbAlpha * 0.5f),
                    shape = CircleShape
                )
                .alpha(orbAlpha * 0.8f)
        )

        // ── Scrollable content ───────────────────────────────────────
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(top = 16.dp, bottom = 40.dp)
        ) {
            // ── Back button ──────────────────────────────────────────
            IconButton(
                onClick = onBack,
                modifier = Modifier.size(48.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.ArrowBack,
                    contentDescription = "Retour",
                    tint = TextPrimary,
                    modifier = Modifier.size(24.dp)
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // ── Title ────────────────────────────────────────────────
            Text(
                text = "Cr\u00e9er un compte",
                fontSize = 28.sp,
                fontWeight = FontWeight.ExtraBold,
                color = TextPrimary,
                fontFamily = FontFamily.SansSerif
            )

            Spacer(modifier = Modifier.height(6.dp))

            // ── Subtitle ─────────────────────────────────────────────
            Text(
                text = "Rejoignez Medika pour acc\u00e9der \u00e0 des soins",
                fontSize = 15.sp,
                color = TextSecondary,
                fontWeight = FontWeight.Normal
            )

            Spacer(modifier = Modifier.height(28.dp))

            // ── Form card ────────────────────────────────────────────
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
                        .padding(horizontal = 24.dp, vertical = 28.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {

                    // ── Nom complet ──────────────────────────────────
                    OutlinedTextField(
                        value = name,
                        onValueChange = {
                            name = it
                            localError = null
                            viewModel.clearRegisterError()
                        },
                        placeholder = { FieldPlaceholder("Nom complet") },
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                        colors = medikaFieldColors(),
                        shape = RoundedCornerShape(16.dp),
                        leadingIcon = { FieldIcon(Icons.Default.Person) }
                    )

                    // ── Email ─────────────────────────────────────────
                    OutlinedTextField(
                        value = email,
                        onValueChange = {
                            email = it
                            localError = null
                            viewModel.clearRegisterError()
                        },
                        placeholder = { FieldPlaceholder("Email") },
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        colors = medikaFieldColors(),
                        shape = RoundedCornerShape(16.dp),
                        leadingIcon = { FieldIcon(Icons.Default.Email) }
                    )

                    // ── T\u00e9l\u00e9phone (509 prefix) ───────────────────────────
                    OutlinedTextField(
                        value = phone,
                        onValueChange = {
                            val cleaned = it.filter { c -> c.isDigit() }
                            phone = when {
                                cleaned.startsWith("509") -> cleaned
                                cleaned.length > 3 -> "509" + cleaned.drop(3)
                                else -> "509"
                            }
                            localError = null
                            viewModel.clearRegisterError()
                        },
                        placeholder = { FieldPlaceholder("509 XX XX XX XX") },
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        colors = medikaFieldColors(),
                        shape = RoundedCornerShape(16.dp),
                        leadingIcon = { FieldIcon(Icons.Default.Phone) }
                    )

                    // ── Age + Sexe row ────────────────────────────────
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        // Age field
                        OutlinedTextField(
                            value = ageText,
                            onValueChange = { input ->
                                if (input.all { c -> c.isDigit() } && input.length <= 3) {
                                    ageText = input
                                    localError = null
                                }
                            },
                            placeholder = { FieldPlaceholder("Age") },
                            singleLine = true,
                            modifier = Modifier
                                .weight(1f)
                                .height(56.dp),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            colors = medikaFieldColors(),
                            shape = RoundedCornerShape(16.dp)
                        )

                        // Gender toggle chips
                        Surface(
                            modifier = Modifier.weight(1f).height(56.dp),
                            shape = RoundedCornerShape(16.dp),
                            color = Green50.copy(alpha = 0.15f),
                            border = BorderStroke(1.dp, Green200.copy(alpha = 0.7f))
                        ) {
                            Row(
                                modifier = Modifier.fillMaxSize(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center
                            ) {
                                // Homme chip
                                GenderChip(
                                    label = "Homme",
                                    isSelected = selectedGender == "Homme",
                                    onSelect = { selectedGender = "Homme" }
                                )

                                Spacer(modifier = Modifier.width(8.dp))

                                // Femme chip
                                GenderChip(
                                    label = "Femme",
                                    isSelected = selectedGender == "Femme",
                                    onSelect = { selectedGender = "Femme" }
                                )
                            }
                        }
                    }

                    // ── Mot de passe ──────────────────────────────────
                    OutlinedTextField(
                        value = password,
                        onValueChange = {
                            password = it
                            localError = null
                            viewModel.clearRegisterError()
                        },
                        placeholder = { FieldPlaceholder("Mot de passe") },
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        visualTransformation = if (passwordVisible) {
                            VisualTransformation.None
                        } else {
                            PasswordVisualTransformation()
                        },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        colors = medikaFieldColors(),
                        shape = RoundedCornerShape(16.dp),
                        leadingIcon = { FieldIcon(Icons.Default.Lock) },
                        trailingIcon = {
                            IconButton(
                                onClick = { passwordVisible = !passwordVisible },
                                modifier = Modifier.size(40.dp)
                            ) {
                                Icon(
                                    imageVector = if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = if (passwordVisible) "Cacher" else "Montrer",
                                    tint = Green500,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                    )

                    // ── Confirmer le mot de passe ─────────────────────
                    OutlinedTextField(
                        value = confirmPassword,
                        onValueChange = {
                            confirmPassword = it
                            localError = null
                        },
                        placeholder = { FieldPlaceholder("Confirmer le mot de passe") },
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        visualTransformation = if (confirmPasswordVisible) {
                            VisualTransformation.None
                        } else {
                            PasswordVisualTransformation()
                        },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        colors = medikaFieldColors(),
                        shape = RoundedCornerShape(16.dp),
                        leadingIcon = { FieldIcon(Icons.Default.Lock) },
                        trailingIcon = {
                            IconButton(
                                onClick = { confirmPasswordVisible = !confirmPasswordVisible },
                                modifier = Modifier.size(40.dp)
                            ) {
                                Icon(
                                    imageVector = if (confirmPasswordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = if (confirmPasswordVisible) "Cacher" else "Montrer",
                                    tint = Green500,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                    )

                    // ── Error display ─────────────────────────────────
                    val displayError = localError ?: registerError
                    if (displayError != null) {
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
                                    text = displayError,
                                    color = SanteDanger,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Medium,
                                    lineHeight = 20.sp
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(4.dp))

                    // ── Create account button ─────────────────────────
                    Button(
                        onClick = {
                            // Local validation
                            localError = when {
                                name.isBlank() -> "Veuillez entrer votre nom complet"
                                email.isBlank() -> "Veuillez entrer votre email"
                                password.isBlank() -> "Veuillez entrer un mot de passe"
                                password.length < 4 -> "Le mot de passe doit contenir au moins 4 caract\u00e8res"
                                password != confirmPassword -> "Les mots de passe ne correspondent pas"
                                selectedGender.isBlank() -> "Veuillez s\u00e9lectionner votre sexe"
                                ageText.isBlank() -> "Veuillez entrer votre \u00e2ge"
                                else -> null
                            }
                            if (localError == null) {
                                viewModel.registerPatient(
                                    username = email,
                                    password = password,
                                    name = name,
                                    email = email,
                                    phone = phone,
                                    age = ageText.toIntOrNull() ?: 0,
                                    gender = selectedGender
                                )
                            }
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        enabled = !isLoading
                            && name.isNotBlank()
                            && email.isNotBlank()
                            && password.isNotBlank()
                            && confirmPassword.isNotBlank()
                            && selectedGender.isNotBlank(),
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
                                    text = "Cr\u00e9ation du compte\u2026",
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        } else {
                            Text(
                                text = "Cr\u00e9er mon compte",
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold,
                                letterSpacing = 0.5.sp
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // ── Already have account link ────────────────────────────
            TextButton(
                onClick = onBack,
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .height(48.dp)
            ) {
                Text(
                    text = "D\u00e9j\u00e0 un compte ? ",
                    color = TextSecondary,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Normal
                )
                Text(
                    text = "Se connecter",
                    color = PrimaryGreen,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // ── Secure registration badge ────────────────────────────
            Surface(
                shape = RoundedCornerShape(24.dp),
                color = Green50.copy(alpha = 0.7f),
                border = BorderStroke(1.dp, Green100.copy(alpha = 0.4f))
            ) {
                Row(
                    modifier = Modifier
                        .padding(horizontal = 18.dp, vertical = 10.dp)
                        .align(Alignment.CenterHorizontally),
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
                        text = "Donn\u00e9es prot\u00e9g\u00e9es \u00b7 Chiffrement TLS",
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

// ─── Reusable Components ─────────────────────────────────────────────

@Composable
private fun GenderChip(
    label: String,
    isSelected: Boolean,
    onSelect: () -> Unit
) {
    Surface(
        onClick = onSelect,
        shape = RoundedCornerShape(10.dp),
        color = if (isSelected) PrimaryGreen else Color.White,
        border = if (!isSelected) BorderStroke(1.dp, Green200) else null
    ) {
        Text(
            text = label,
            fontSize = 13.sp,
            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (isSelected) Color.White else TextSecondary,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp)
        )
    }
}

@Composable
private fun FieldIcon(icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Icon(
        imageVector = icon,
        contentDescription = null,
        tint = Green500,
        modifier = Modifier.size(20.dp)
    )
}

@Composable
private fun FieldPlaceholder(text: String) {
    Text(
        text = text,
        color = Green400.copy(alpha = 0.6f),
        fontSize = 15.sp
    )
}

@Composable
private fun medikaFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = PrimaryGreen,
    focusedLabelColor = PrimaryGreen,
    cursorColor = PrimaryGreen,
    unfocusedBorderColor = Green200.copy(alpha = 0.7f),
    unfocusedContainerColor = Green50.copy(alpha = 0.15f),
    focusedContainerColor = Color.White,
    disabledContainerColor = Green50.copy(alpha = 0.08f)
)
