package com.example.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColorScheme = lightColorScheme(
    primary = PrimaryGreen,
    onPrimary = Color.White,
    primaryContainer = LightGreen,
    onPrimaryContainer = Green800,
    secondary = DarkGreen,
    onSecondary = Color.White,
    secondaryContainer = Green100,
    onSecondaryContainer = Green900,
    tertiary = SanteSuccess,
    onTertiary = Color.White,
    background = SanteBackground,
    onBackground = TextPrimary,
    surface = SanteCard,
    onSurface = TextPrimary,
    surfaceVariant = Green50,
    onSurfaceVariant = TextSecondary,
    outline = Color(0xFFD1D5DB),
    outlineVariant = Green100,
    error = SanteDanger,
    onError = Color.White,
    errorContainer = Color(0xFFFEE2E2),
    onErrorContainer = Color(0xFF991B1B)
)

@Composable
fun SanteTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LightColorScheme,
        typography = Typography,
        content = content
    )
}