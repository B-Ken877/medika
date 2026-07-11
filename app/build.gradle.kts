plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.example"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.medika.santelien"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            isShrinkResources = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        // Exclude unused Agora extensions — saves ~20 MB
        jniLibs {
            excludes += listOf(
                "**/libagora_lip_sync_extension.so",
                "**/libagora_spatial_audio_extension.so"
            )
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.navigation:navigation-compose:2.8.5")

    // Compose
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.material:material-icons-extended")

    // Room
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // Network
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-moshi:2.11.0")
    implementation("com.squareup.moshi:moshi-kotlin:1.15.2")
    ksp("com.squareup.moshi:moshi-kotlin-codegen:1.15.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // Image loading
    implementation("io.coil-kt:coil-compose:2.7.0")

    // AppCompat — required by ZEGOCLOUD UIKit (ZegoSendCallInvitationButton
    // extends AppCompatTextView)
    implementation("androidx.appcompat:appcompat:1.7.0")

    // ZEGOCLOUD UIKit Prebuilt Call — replaces LiveKit.
    // Handles call invitations, ringing, WebRTC, call UI, mute/camera, hang-up.
    // Version pinned. Firebase (firebase-messaging) and zpns-fcm are EXCLUDED
    // because this app has no google-services.json / Firebase setup.
    // Incoming call push when the app is killed will NOT work, but in-app
    // call invitations (both users online) work perfectly.
    // Agora RTC SDK for voice/video calls (replaces ZEGO calling)
    implementation("io.agora.rtc:full-sdk:4.4.0")

    // ZEGOCLOUD ZIM SDK — In-app Chat (text + media messages).
    // Version pinned to match the transitive version pulled by the UIKit above.
    implementation("im.zego:zim:2.29.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

