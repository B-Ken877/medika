package com.example.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val MedikaLightColorScheme = lightColorScheme(
    primary = PrimaryGreen,
    onPrimary = TextOnPrimary,
    primaryContainer = Green50,
    onPrimaryContainer = Green800,
    secondary = Green700,
    onSecondary = Color.White,
    secondaryContainer = Green100,
    onSecondaryContainer = Green900,
    tertiary = SanteInfo,
    onTertiary = Color.White,
    tertiaryContainer = SanteInfoBg,
    onTertiaryContainer = Neutral800,
    error = SanteDanger,
    onError = Color.White,
    errorContainer = SanteDangerBg,
    onErrorContainer = Neutral800,
    background = SanteBackground,
    onBackground = TextPrimary,
    surface = SanteSurface,
    onSurface = TextPrimary,
    surfaceVariant = Neutral100,
    onSurfaceVariant = TextSecondary,
    outline = Neutral200,
    outlineVariant = Neutral200,
    inverseSurface = Neutral800,
    inverseOnSurface = Neutral50,
    inversePrimary = Green200,
    surfaceTint = PrimaryGreen,
)

@Composable
fun SanteTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = MedikaLightColorScheme,
        typography = Typography,
        content = content
    )
}
