# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ── Medika keep rules ────────────────────────────────────────

# Room entities (annotated classes)
-keep @androidx.room.Entity class *
-keepclassmembers class * { @androidx.room.PrimaryKey *; }

# Moshi models (JSON serialization)
-keep class com.example.data.dto.** { *; }
-keep class com.example.data.api.** { *; }

# Retrofit + Moshi
-dontwarn retrofit2.**
-keep class retrofit2.** { *; }
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Agora RTC SDK
-keep class io.agora.** { *; }
-dontwarn io.agora.**

# ZEGO SDKs
-keep class im.zego.** { *; }
-dontwarn im.zego.**

# Coil image loading
-keep class coil.** { *; }
-dontwarn coil.**

# Compose (keep composables)
-keep class androidx.compose.** { *; }
-dontwarn androidx.compose.**

# Keep CrashLogger
-keep class com.example.CrashLogger { *; }

# Keep all @Keep annotated classes/members
-keep @androidx.annotation.Keep class * { *; }
-keepclassmembers class * { @androidx.annotation.Keep *; }

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
