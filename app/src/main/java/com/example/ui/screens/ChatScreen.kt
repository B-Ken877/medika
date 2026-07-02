package com.example.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.view.ViewGroup
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.util.UUID
import com.example.data.db.MessageEntity
import com.example.ui.AuthState
import com.example.ui.SanteViewModel
import com.example.ui.components.MessageBubble
import com.example.ui.theme.*

// WhatsApp-style chat wallpaper: very subtle warm cream with a hint of green
private val ChatWallpaper = Color(0xFFEFE5D5)  // warm parchment
private val ChatWallpaperDark = Color(0xFFE5DAC4)
private val InputBarColor = Color(0xFFFDFDFB)
private val TopBarColor = PrimaryGreen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    viewModel: SanteViewModel,
    onBack: () -> Unit = {}
) {
    val activeConsultation by viewModel.activeConsultation.collectAsStateWithLifecycle()
    val messages by viewModel.activeMessages.collectAsStateWithLifecycle()
    val authState by viewModel.authState.collectAsStateWithLifecycle()
    val activeCall by viewModel.activeCall.collectAsStateWithLifecycle()
    val isTyping by viewModel.isTyping.collectAsStateWithLifecycle()
    val wsConnected by viewModel.wsConnected.collectAsStateWithLifecycle()
    val isRecording by viewModel.isRecording.collectAsStateWithLifecycle()
    val recordingDuration by viewModel.recordingDuration.collectAsStateWithLifecycle()
    val uploadError by viewModel.uploadError.collectAsStateWithLifecycle()
    val zegoCallReady by viewModel.zegoCallReady.collectAsStateWithLifecycle()
    val zegoChatReady by viewModel.zegoChatReady.collectAsStateWithLifecycle()

    var showPrescriptionDialog by rememberSaveable { mutableStateOf(false) }
    var messageText by remember { mutableStateOf("") }
    var showMediaPicker by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val context = LocalContext.current

    val (senderId, senderName) = when (val auth = authState) {
        is AuthState.PatientAuthenticated -> auth.serverUser.id to auth.profile.name
        is AuthState.DoctorAuthenticated -> auth.serverUser.id to auth.doctor.name
        else -> "" to ""
    }
    val isDoctor = authState is AuthState.DoctorAuthenticated
    val peerName = when (authState) {
        is AuthState.PatientAuthenticated -> activeConsultation?.let { "Dr. ${it.patientName}" } ?: "Medecin"
        is AuthState.DoctorAuthenticated -> activeConsultation?.patientName ?: "Patient"
        else -> "Consultation"
    }
    // Compute the peer's Zego user ID. The peer ID MUST match the userID used
    // to init ZegoUIKitPrebuiltCallService (the server user ID).
    val peerUserId = when (authState) {
        is AuthState.PatientAuthenticated -> activeConsultation?.doctorId
        is AuthState.DoctorAuthenticated -> activeConsultation?.patientId
        else -> null
    }

    // ─── Mic permission launcher ───
    val micPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        viewModel.onMicPermissionResult(granted)
    }

    val requestMicPermission by viewModel.requestMicPermission.collectAsStateWithLifecycle()
    LaunchedEffect(requestMicPermission) {
        if (requestMicPermission) {
            micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }



    // ─── Media picker launcher ───
    var pendingMimeType by remember { mutableStateOf("") }

    val mediaLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null && pendingMimeType.isNotEmpty()) {
            val mimeType = context.contentResolver.getType(uri) ?: pendingMimeType
            viewModel.sendMediaMessage(context, uri, senderId, senderName, mimeType)
        }
        pendingMimeType = ""
    }

    // Auto-scroll to bottom on new messages
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    // Show upload errors as a Toast so the user gets immediate feedback
    LaunchedEffect(uploadError) {
        uploadError?.let {
            android.widget.Toast.makeText(context, it, android.widget.Toast.LENGTH_LONG).show()
            viewModel.consumeUploadError()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(TopBarColor)
            .imePadding()
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // ── Top App Bar (WhatsApp-style) ──
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = TopBarColor,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                    actionIconContentColor = Color.White
                ),
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
                    }
                },
                title = {
                    Column {
                        Text(
                            peerName,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 16.sp,
                            color = Color.White
                        )
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(6.dp)
                                    .background(
                                        if (wsConnected) Color(0xFFB6FCC8) else Color(0xFFFFD7A8),
                                        CircleShape
                                    )
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                if (isTyping) "ecrit..." else if (wsConnected) "en ligne" else "connexion...",
                                fontSize = 12.sp,
                                color = Color.White.copy(alpha = 0.85f)
                            )
                        }
                    }
                },
                actions = {
                    // ZEGOCLOUD call buttons — only show if Zego Call service is
                    // initialized. If not ready, show a disabled placeholder so
                    // the user knows calls aren't available yet.
                    if (peerUserId != null && zegoCallReady) {
                        // Voice call button — sends ZIM message then opens CallActivity
                        IconButton(onClick = {
                            val roomId = "call_${senderId}_${peerUserId}_${System.currentTimeMillis()}"
                            viewModel.sendCallRequest(context, roomId, peerUserId, peerName, isVideo = false)
                        }) {
                            Icon(Icons.Default.Call, contentDescription = "Appel vocal", tint = Color.White)
                        }
                        // Video call button
                        IconButton(onClick = {
                            val roomId = "call_${senderId}_${peerUserId}_${System.currentTimeMillis()}"
                            viewModel.sendCallRequest(context, roomId, peerUserId, peerName, isVideo = true)
                        }) {
                            Icon(Icons.Default.Videocam, contentDescription = "Appel video", tint = Color.White)
                        }
                    }
                    if (isDoctor && activeConsultation?.status == "EN_COURS") {
                        TextButton(onClick = { showPrescriptionDialog = true }) {
                            Text(
                                "Ordonnance",
                                color = Color.White,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }
                }
            )

            // ── Messages area (chat wallpaper) ──
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(ChatWallpaper)
            ) {
                if (messages.isEmpty()) {
                    // Empty state — discreet centered pill (WhatsApp-style)
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = Color(0xFFFFF8E7).copy(alpha = 0.9f),
                            shadowElevation = 1.dp
                        ) {
                            Text(
                                "Demarrez la conversation",
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                fontSize = 13.sp,
                                color = TextSecondary
                            )
                        }
                    }
                } else {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = 8.dp, end = 8.dp,
                            top = 10.dp, bottom = 10.dp
                        ),
                        verticalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        // Date separator at the top
                        item {
                            DateSeparator("Aujourd'hui")
                        }
                        items(messages, key = { it.id }) { message ->
                            val isFromMe = message.senderId == senderId
                            if (message.senderId == "system") {
                                // System message — centered pill
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 6.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = Color(0xFFFFF8E7).copy(alpha = 0.95f)
                                    ) {
                                        Text(
                                            message.text,
                                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
                                            fontSize = 12.sp,
                                            color = TextSecondary,
                                            fontWeight = FontWeight.Medium
                                        )
                                    }
                                }
                            } else {
                                MessageBubble(
                                    message = message,
                                    isFromMe = isFromMe,
                                    onRetry = { id ->
                                        if (message.messageType == "text") {
                                            viewModel.retrySendTextMessage(id)
                                        } else {
                                            viewModel.retrySendMediaMessage(id)
                                        }
                                    }
                                )
                            }
                        }
                    }
                }

                // Typing indicator floating above the input bar
                if (isTyping) {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = Color.White,
                        shadowElevation = 1.dp,
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(start = 16.dp, bottom = 6.dp)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(3.dp)
                        ) {
                            val inf = rememberInfiniteTransition(label = "dots")
                            listOf(0, 1, 2).forEach { i ->
                                val offset by inf.animateFloat(
                                    0f, -5f,
                                    animationSpec = infiniteRepeatable(
                                        tween(400, delayMillis = i * 150),
                                        RepeatMode.Reverse
                                    ),
                                    label = "dot_$i"
                                )
                                Box(
                                    modifier = Modifier
                                        .size(6.dp)
                                        .offset(y = offset.dp)
                                        .background(Green500, CircleShape)
                                )
                            }
                        }
                    }
                }
            }

            // ── Recording indicator (above input bar) ──
            if (isRecording) {
                Surface(color = Color(0xFFFFEBEE), modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(10.dp)
                                .background(Color(0xFFE53935), CircleShape)
                        )
                        Text(
                            "Enregistrement... ${String.format("%02d:%02d", recordingDuration / 60, recordingDuration % 60)}",
                            color = Color(0xFFC62828),
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            "Glisser pour annuler",
                            color = TextSecondary,
                            fontSize = 11.sp
                        )
                    }
                }
            }

            // ── Input bar (WhatsApp-style, bottom-anchored) ──
            ChatInputBar(
                messageText = messageText,
                onMessageTextChange = {
                    messageText = it
                    if (it.isNotBlank()) viewModel.sendTypingIndication()
                },
                onSendText = {
                    if (messageText.isNotBlank()) {
                        viewModel.sendChatMessage(messageText, senderId, senderName)
                        messageText = ""
                    }
                },
                onAttachClick = { showMediaPicker = true },
                onMicClick = {
                    if (isRecording) {
                        viewModel.stopAndSendVoiceRecording(senderId, senderName)
                    } else {
                        viewModel.requestMicAndStartRecording(senderId, senderName)
                    }
                },
                isRecording = isRecording
            )
        }
    }

    // ── Media picker bottom sheet ──
    if (showMediaPicker) {
        ModalBottomSheet(
            onDismissRequest = { showMediaPicker = false },
            containerColor = Color.White
        ) {
            Column(modifier = Modifier.padding(bottom = 24.dp)) {
                Text(
                    "Joindre un fichier",
                    modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 16.dp),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )
                AttachmentOption(
                    icon = Icons.Default.Photo,
                    label = "Photo / Image",
                    iconColor = Color(0xFF6C5CE7),
                    iconBg = Color(0xFFEEE9FF)
                ) {
                    showMediaPicker = false
                    pendingMimeType = "image/*"
                    mediaLauncher.launch("image/*")
                }
                AttachmentOption(
                    icon = Icons.Default.Videocam,
                    label = "Video",
                    iconColor = Color(0xFFE17055),
                    iconBg = Color(0xFFFFE9E2)
                ) {
                    showMediaPicker = false
                    pendingMimeType = "video/*"
                    mediaLauncher.launch("video/*")
                }
            }
        }
    }

    // ── Prescription Dialog ──
    if (showPrescriptionDialog) {
        PrescriptionDialog(
            onDismiss = { showPrescriptionDialog = false },
            onConfirm = { text ->
                val consId = activeConsultation?.id ?: return@PrescriptionDialog
                viewModel.writePrescription(consId, text)
                showPrescriptionDialog = false
            }
        )
    }
}

@Composable
private fun DateSeparator(label: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = Color(0xFFE0DDD5).copy(alpha = 0.85f)
        ) {
            Text(
                label,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
                fontSize = 11.sp,
                color = TextSecondary,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

@Composable
private fun AttachmentOption(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    iconColor: Color,
    iconBg: Color,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        color = Color.Transparent,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .padding(horizontal = 24.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(iconBg),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, contentDescription = null, tint = iconColor, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(20.dp))
            Text(label, fontSize = 16.sp, color = TextPrimary)
        }
    }
}

@Composable
private fun ChatInputBar(
    messageText: String,
    onMessageTextChange: (String) -> Unit,
    onSendText: () -> Unit,
    onAttachClick: () -> Unit,
    onMicClick: () -> Unit,
    isRecording: Boolean
) {
    Surface(
        color = InputBarColor,
        shadowElevation = 0.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Attachment button (left)
            IconButton(
                onClick = onAttachClick,
                modifier = Modifier.size(44.dp)
            ) {
                Icon(
                    Icons.Default.Add,
                    contentDescription = "Joindre",
                    tint = TextSecondary,
                    modifier = Modifier.size(26.dp)
                )
            }

            Spacer(Modifier.width(2.dp))

            // Text field (center, fills width)
            OutlinedTextField(
                value = messageText,
                onValueChange = onMessageTextChange,
                placeholder = { Text("Message", color = TextSecondary.copy(alpha = 0.7f), fontSize = 15.sp) },
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 48.dp, max = 120.dp),
                shape = RoundedCornerShape(22.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color.Transparent,
                    unfocusedBorderColor = Color.Transparent,
                    cursorColor = PrimaryGreen,
                    unfocusedContainerColor = Color(0xFFF2F2F2),
                    focusedContainerColor = Color(0xFFF2F2F2)
                ),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
                keyboardActions = KeyboardActions(onSend = {
                    if (messageText.isNotBlank()) onSendText()
                }),
                maxLines = 4,
                trailingIcon = null
            )

            Spacer(Modifier.width(4.dp))

            // Send or Mic button (right) — single round green button
            Surface(
                onClick = {
                    if (messageText.isBlank()) onMicClick() else onSendText()
                },
                shape = CircleShape,
                color = if (isRecording) Color(0xFFE53935) else PrimaryGreen,
                modifier = Modifier.size(48.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        when {
                            isRecording -> Icons.Default.Stop
                            messageText.isBlank() -> Icons.Default.Mic
                            else -> Icons.AutoMirrored.Filled.Send
                        },
                        contentDescription = if (messageText.isBlank()) "Micro" else "Envoyer",
                        tint = Color.White,
                        modifier = Modifier.size(22.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun PrescriptionDialog(onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var prescriptionText by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        shape = RoundedCornerShape(20.dp),
        title = { Text("Ordonnance", fontWeight = FontWeight.Bold, color = TextPrimary) },
        text = {
            OutlinedTextField(
                value = prescriptionText,
                onValueChange = { prescriptionText = it },
                placeholder = { Text("Rediger l'ordonnance...") },
                modifier = Modifier.fillMaxWidth().height(200.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = PrimaryGreen,
                    unfocusedBorderColor = Green200,
                    cursorColor = PrimaryGreen,
                    unfocusedContainerColor = Green50,
                    focusedContainerColor = Green50
                ),
                shape = RoundedCornerShape(12.dp)
            )
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(prescriptionText) }) {
                Text("Signer", color = PrimaryGreen, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Annuler", color = TextSecondary)
            }
        }
    )

}
