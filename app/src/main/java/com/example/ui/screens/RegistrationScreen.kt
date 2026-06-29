package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ui.AuthState
import com.example.ui.SanteViewModel
import com.example.ui.components.AnimatedButton
import com.example.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RegistrationScreen(
    viewModel: SanteViewModel,
    onBack: () -> Unit = {},
    onRegisterSuccess: () -> Unit = {}
) {
    val authState by viewModel.authState.collectAsStateWithLifecycle()
    val registerError by viewModel.registerError.collectAsStateWithLifecycle()

    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var ageText by remember { mutableStateOf("") }
    var selectedGender by remember { mutableStateOf("Homme") }
    var passwordVisible by remember { mutableStateOf(false) }
    var confirmPasswordVisible by remember { mutableStateOf(false) }

    val genders = listOf("Homme", "Femme")

    // Navigate to home on successful registration
    LaunchedEffect(authState) {
        if (authState is AuthState.PatientAuthenticated && registerError == null) {
            onRegisterSuccess()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 16.dp)
        ) {
            // Back button
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.Default.ArrowBack,
                    contentDescription = "Retour",
                    tint = TextPrimary
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Logo
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .background(PrimaryGreen.copy(alpha = 0.1f), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Favorite,
                    contentDescription = "Medika",
                    tint = PrimaryGreen,
                    modifier = Modifier.size(28.dp)
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Creer un compte",
                fontSize = 26.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary
            )

            Spacer(modifier = Modifier.height(4.dp))

            Text(
                text = "Inscrivez-vous pour acceder aux consultations",
                fontSize = 14.sp,
                color = TextSecondary
            )

            Spacer(modifier = Modifier.height(20.dp))

            // Form card
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                color = Green50,
                shadowElevation = 1.dp
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Name
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it; viewModel.clearRegisterError() },
                        label = { Text("Nom complet") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        colors = fieldColors(),
                        shape = RoundedCornerShape(12.dp),
                        leadingIcon = { FieldIcon(Icons.Default.Person) }
                    )

                    // Username
                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it; viewModel.clearRegisterError() },
                        label = { Text("Nom d'utilisateur") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        colors = fieldColors(),
                        shape = RoundedCornerShape(12.dp),
                        leadingIcon = { FieldIcon(Icons.Default.Person) }
                    )

                    // Password
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it; viewModel.clearRegisterError() },
                        label = { Text("Mot de passe") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        colors = fieldColors(),
                        shape = RoundedCornerShape(12.dp),
                        leadingIcon = { FieldIcon(Icons.Default.Favorite) },
                        trailingIcon = {
                            IconButton(onClick = { passwordVisible = !passwordVisible }) {
                                Icon(
                                    imageVector = if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = null,
                                    tint = Green500
                                )
                            }
                        }
                    )

                    // Confirm password
                    OutlinedTextField(
                        value = confirmPassword,
                        onValueChange = { confirmPassword = it },
                        label = { Text("Confirmer le mot de passe") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        visualTransformation = if (confirmPasswordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        colors = fieldColors(),
                        shape = RoundedCornerShape(12.dp),
                        leadingIcon = { FieldIcon(Icons.Default.Favorite) },
                        trailingIcon = {
                            IconButton(onClick = { confirmPasswordVisible = !confirmPasswordVisible }) {
                                Icon(
                                    imageVector = if (confirmPasswordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = null,
                                    tint = Green500
                                )
                            }
                        }
                    )

                    // Email
                    OutlinedTextField(
                        value = email,
                        onValueChange = { email = it },
                        label = { Text("Email (optionnel)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        colors = fieldColors(),
                        shape = RoundedCornerShape(12.dp),
                        leadingIcon = { FieldIcon(Icons.Default.Person) }
                    )

                    // Phone
                    OutlinedTextField(
                        value = phone,
                        onValueChange = { phone = it },
                        label = { Text("Telephone (optionnel)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        colors = fieldColors(),
                        shape = RoundedCornerShape(12.dp),
                        leadingIcon = { FieldIcon(Icons.Default.Person) }
                    )

                    // Age + Gender row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        OutlinedTextField(
                            value = ageText,
                            onValueChange = { if (it.all { c -> c.isDigit() } && it.length <= 3) ageText = it },
                            label = { Text("Age") },
                            singleLine = true,
                            modifier = Modifier.weight(1f),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            colors = fieldColors(),
                            shape = RoundedCornerShape(12.dp)
                        )

                        // Gender selector
                        Surface(
                            modifier = Modifier.weight(1f).height(56.dp),
                            shape = RoundedCornerShape(12.dp),
                            color = Color.White,
                            border = androidx.compose.foundation.BorderStroke(1.dp, Green200)
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(horizontal = 12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                genders.forEach { gender ->
                                    val isSelected = selectedGender == gender
                                    Surface(
                                        onClick = { selectedGender = gender },
                                        shape = RoundedCornerShape(8.dp),
                                        color = if (isSelected) PrimaryGreen else Green50
                                    ) {
                                        Text(
                                            text = gender,
                                            fontSize = 12.sp,
                                            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                                            color = if (isSelected) Color.White else TextSecondary,
                                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // Error message
                    val errorToShow = registerError
                    if (errorToShow != null) {
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = SanteDanger.copy(alpha = 0.1f)
                        ) {
                            Text(
                                text = errorToShow,
                                color = SanteDanger,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(10.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(4.dp))

                    // Local validation message
                    var localError by remember { mutableStateOf<String?>(null) }

                    if (localError != null) {
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = SanteDanger.copy(alpha = 0.1f)
                        ) {
                            Text(
                                text = localError ?: "",
                                color = SanteDanger,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(10.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(4.dp))

                    // Register button
                    when (authState) {
                        is AuthState.Loading -> {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(52.dp)
                                    .background(PrimaryGreen, RoundedCornerShape(14.dp)),
                                contentAlignment = Alignment.Center
                            ) {
                                CircularProgressIndicator(
                                    color = Color.White,
                                    strokeWidth = 3.dp,
                                    modifier = Modifier.size(26.dp)
                                )
                            }
                        }
                        else -> {
                            AnimatedButton(
                                text = "S'inscrire",
                                onClick = {
                                    localError = when {
                                        password != confirmPassword -> "Les mots de passe ne correspondent pas"
                                        password.length < 4 -> "Le mot de passe doit contenir au moins 4 caracteres"
                                        else -> null
                                    }
                                    if (localError == null) {
                                        viewModel.registerPatient(
                                            username = username,
                                            password = password,
                                            name = name,
                                            email = email,
                                            phone = phone,
                                            age = ageText.toIntOrNull() ?: 0,
                                            gender = selectedGender
                                        )
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Login link
            TextButton(
                onClick = onBack,
                modifier = Modifier.align(Alignment.CenterHorizontally)
            ) {
                Text("Deja un compte ? Se connecter", color = PrimaryGreen, fontWeight = FontWeight.Medium)
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
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
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = PrimaryGreen,
    focusedLabelColor = PrimaryGreen,
    cursorColor = PrimaryGreen,
    unfocusedBorderColor = Green200,
    unfocusedContainerColor = Color.White,
    focusedContainerColor = Color.White
)