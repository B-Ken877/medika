package com.example.ui.screens

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.data.db.MessageEntity
import com.example.ui.AuthState
import com.example.ui.SanteViewModel
import com.example.ui.components.MessageBubble
import com.example.ui.theme.Neutral100
import com.example.ui.theme.Neutral200
import com.example.ui.theme.Neutral400
import com.example.ui.theme.Neutral800
import com.example.ui.theme.PrimaryGreen
import com.example.ui.theme.PrimaryGreenLight
import com.example.ui.theme.SanteDanger
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary
import com.example.ui.theme.TextTertiary
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

private val ChatBackground = Color(0xFFF0F2F5)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    viewModel: SanteViewModel,
    onNavigate: (String) -> Unit = {},
    onBack: () -> Unit = {},
) {
    val authState by viewModel.authState.collectAsStateWithLifecycle()
    val messages by viewModel.activeMessages.collectAsStateWithLifecycle()
    val activeConsultation by viewModel.activeConsultation.collectAsStateWithLifecycle()
    val isTyping by viewModel.isTyping.collectAsStateWithLifecycle()
    val wsConnected by viewModel.wsConnected.collectAsStateWithLifecycle()
    val isRecording by viewModel.isRecording.collectAsStateWithLifecycle()
    val recordingDuration by viewModel.recordingDuration.collectAsStateWithLifecycle()
    val uploadError by viewModel.uploadError.collectAsStateWithLifecycle()

    var messageText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val context = LocalContext.current

    // Show upload errors as toasts
    LaunchedEffect(uploadError) {
        if (uploadError != null) {
            Toast.makeText(context, uploadError, Toast.LENGTH_LONG).show()
            viewModel.consumeUploadError()
        }
    }

    // Current user identity
    val (currentUserId, currentUserName) = when (val auth = authState) {
        is AuthState.PatientAuthenticated -> auth.serverUser.id to auth.profile.name
        is AuthState.DoctorAuthenticated -> auth.serverUser.id to auth.doctor.name
        else -> "" to ""
    }

    // Peer display name
    val peerName = when (authState) {
        is AuthState.PatientAuthenticated ->
            activeConsultation?.patientName?.let { if (it.isNotBlank()) it else null }
                ?.let { "Dr. $it" } ?: "M\u00e9decin"
        is AuthState.DoctorAuthenticated ->
            activeConsultation?.patientName ?: "Patient"
        else -> "Consultation"
    }

    // Peer user ID for call routing
    val peerUserId = when (authState) {
        is AuthState.PatientAuthenticated -> activeConsultation?.doctorId
        is AuthState.DoctorAuthenticated -> activeConsultation?.patientId
        else -> null
    }


    // Media picker launcher
    val mediaLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) {
            viewModel.sendMediaMessage(context, uri, currentUserId, currentUserName, "image/*")
        }
    }

    // Determine storage permission based on API level
    val storagePermission = if (android.os.Build.VERSION.SDK_INT >= 33) {
        Manifest.permission.READ_MEDIA_IMAGES
    } else {
        Manifest.permission.READ_EXTERNAL_STORAGE
    }

    // Storage permission for media
    val storagePermLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            mediaLauncher.launch("image/*")
        } else {
            Toast.makeText(context, "Permission de stockage requise", Toast.LENGTH_SHORT).show()
        }
    }


    // Auto-scroll to bottom on new messages
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(index = messages.size)
        }
    }

    Scaffold(
        topBar = {
            ChatTopBar(
                peerName = peerName,
                isOnline = wsConnected,
                isTyping = isTyping,
                onBack = onBack,
                onVideoCall = {
                    if (peerUserId != null) {
                        viewModel.startCall(activeConsultation?.id ?: "", peerName, null, true)
                    } else {
                        Toast.makeText(context, "Destinataire inconnu", Toast.LENGTH_SHORT).show()
                    }
                },
                onVoiceCall = {
                    if (peerUserId != null) {
                        viewModel.startCall(activeConsultation?.id ?: "", peerName, null, false)
                    } else {
                        Toast.makeText(context, "Destinataire inconnu", Toast.LENGTH_SHORT).show()
                    }
                },
            )
        },
        bottomBar = {
            Box(modifier = Modifier.imePadding()) {
                ChatInputBar(
                    messageText = messageText,
                    onMessageTextChanged = { messageText = it },
                    onSend = {
                        if (messageText.isNotBlank()) {
                            viewModel.sendChatMessage(
                                text = messageText.trim(),
                                senderId = currentUserId,
                                senderName = currentUserName,
                            )
                            messageText = ""
                        }
                    },
                    isRecording = isRecording,
                    recordingDuration = recordingDuration,
                    onStartRecording = { viewModel.requestMicAndStartRecording(currentUserId, currentUserName) },
                    onStopRecording = { viewModel.stopAndSendVoiceRecording(currentUserId, currentUserName) },
                    onAttachMedia = {
                        // Request storage permission then launch picker
                        val storagePerm = if (android.os.Build.VERSION.SDK_INT >= 33) {
                            Manifest.permission.READ_MEDIA_IMAGES
                        } else {
                            Manifest.permission.READ_EXTERNAL_STORAGE
                        }
                        val hasPerm = context.checkSelfPermission(storagePerm) ==
                            android.content.pm.PackageManager.PERMISSION_GRANTED
                        if (hasPerm) {
                            mediaLauncher.launch("image/*")
                        } else {
                            storagePermLauncher.launch(storagePerm)
                        }
                    },
                )
            }
        },
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(ChatBackground)
                .padding(innerPadding),
        ) {
            if (messages.isEmpty() && !isRecording) {
                EmptyChatPlaceholder()
            } else {
                MessageList(
                    messages = messages,
                    currentUserId = currentUserId,
                    listState = listState,
                    onPlayVoice = { viewModel.playVoiceMessage(it) },
                )
            }

            // Typing indicator above the input bar
            if (isTyping) {
                TypingIndicator(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 12.dp, bottom = 72.dp),
                )
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Top App Bar
// ═══════════════════════════════════════════════════════════════════════

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatTopBar(
    peerName: String,
    isOnline: Boolean,
    isTyping: Boolean,
    onBack: () -> Unit,
    onVideoCall: () -> Unit,
    onVoiceCall: () -> Unit,
) {
    TopAppBar(
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = PrimaryGreen,
            titleContentColor = Color.White,
            navigationIconContentColor = Color.White,
            actionIconContentColor = Color.White,
        ),
        title = {
            Column {
                Text(
                    text = peerName,
                    fontWeight = FontWeight.Bold,
                    fontSize = 17.sp,
                    color = Color.White,
                    maxLines = 1,
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(7.dp)
                            .clip(CircleShape)
                            .background(
                                if (isOnline) PrimaryGreenLight
                                else Color.White.copy(alpha = 0.4f),
                            ),
                    )
                    Text(
                        text = when {
                            isTyping -> "\u00e9crit..."
                            isOnline -> "En ligne"
                            else -> "Hors ligne"
                        },
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Normal,
                        color = when {
                            isTyping -> PrimaryGreenLight
                            isOnline -> PrimaryGreenLight
                            else -> Color.White.copy(alpha = 0.7f)
                        },
                    )
                }
            }
        },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Retour",
                    tint = Color.White,
                )
            }
        },
        actions = {
            IconButton(onClick = onVoiceCall) {
                Icon(
                    imageVector = Icons.Default.Call,
                    contentDescription = "Appel vocal",
                    tint = Color.White,
                )
            }
            IconButton(onClick = onVideoCall) {
                Icon(
                    imageVector = Icons.Default.Videocam,
                    contentDescription = "Appel vid\u00e9o",
                    tint = Color.White,
                )
            }
        },
    )
}

// ═══════════════════════════════════════════════════════════════════════
// Message List
// ═══════════════════════════════════════════════════════════════════════

@Composable
private fun MessageList(
    messages: List<MessageEntity>,
    currentUserId: String,
    listState: androidx.compose.foundation.lazy.LazyListState,
    onPlayVoice: ((MessageEntity) -> Unit)? = null,
) {
    val displayItems = remember(messages) { buildDisplayItems(messages, currentUserId) }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        items(
            count = displayItems.size,
            key = { displayItems[it].key }
        ) { index ->
            val item = displayItems[index]
            when (item) {
                is DisplayItem.DateSeparator -> DateSeparator(label = item.label)
                is DisplayItem.MessageItem -> {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = if (item.isOwn) Alignment.End else Alignment.Start,
                    ) {
                        if (item.showSenderName && !item.isOwn && item.senderName.isNotBlank()) {
                            Text(
                                text = item.senderName,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = PrimaryGreen,
                                modifier = Modifier.padding(
                                    bottom = 2.dp,
                                    start = 12.dp,
                                    top = 6.dp,
                                ),
                            )
                        }
                        MessageBubble(message = item.message, isOwn = item.isOwn, onPlayVoice = onPlayVoice)
                    }
                }
            }
        }
    }
}

private sealed class DisplayItem {
    abstract val key: String
    data class DateSeparator(val label: String, override val key: String) : DisplayItem()
    data class MessageItem(
        val message: MessageEntity,
        val isOwn: Boolean,
        val showSenderName: Boolean,
        val senderName: String,
        override val key: String,
    ) : DisplayItem()
}

private fun buildDisplayItems(
    messages: List<MessageEntity>,
    currentUserId: String,
): List<DisplayItem> {
    val items = mutableListOf<DisplayItem>()
    val todayCal = Calendar.getInstance()
    val todayPair = todayCal.get(Calendar.DAY_OF_YEAR) to todayCal.get(Calendar.YEAR)
    val yesterdayCal = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -1) }
    val yesterdayPair = yesterdayCal.get(Calendar.DAY_OF_YEAR) to yesterdayCal.get(Calendar.YEAR)
    val msgCal = Calendar.getInstance()

    var lastDayYear: Pair<Int, Int>? = null
    var lastSenderId: String? = null

    for (msg in messages) {
        val isOwn = msg.senderId == currentUserId
        msgCal.timeInMillis = msg.timestamp
        val dayYear = msgCal.get(Calendar.DAY_OF_YEAR) to msgCal.get(Calendar.YEAR)

        if (dayYear != lastDayYear) {
            val label = when (dayYear) {
                todayPair -> "Aujourd\u2019hui"
                yesterdayPair -> "Hier"
                else -> SimpleDateFormat("dd MMMM yyyy", Locale.FRENCH).format(Date(msg.timestamp))
            }
            items.add(DisplayItem.DateSeparator(label, "date_${dayYear.first}_${dayYear.second}"))
            lastSenderId = null
        }
        lastDayYear = dayYear

        val showSenderName = msg.senderId != lastSenderId
        lastSenderId = msg.senderId

        items.add(
            DisplayItem.MessageItem(
                message = msg,
                isOwn = isOwn,
                showSenderName = showSenderName,
                senderName = msg.senderName,
                key = "msg_${msg.id}",
            )
        )
    }
    return items
}

// ═══════════════════════════════════════════════════════════════════════
// Date Separator
// ═══════════════════════════════════════════════════════════════════════

@Composable
private fun DateSeparator(label: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = Neutral200.copy(alpha = 0.65f),
        ) {
            Text(
                text = label,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = Neutral800,
            )
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Typing Indicator
// ═══════════════════════════════════════════════════════════════════════

@Composable
private fun TypingIndicator(modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "typing")

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = Color.White,
        shadowElevation = 2.dp,
        modifier = modifier,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            repeat(3) { index ->
                val offset by transition.animateFloat(
                    initialValue = 0f,
                    targetValue = -5f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(350, delayMillis = index * 120),
                        repeatMode = RepeatMode.Reverse,
                    ),
                    label = "dot_$index",
                )
                Box(
                    modifier = Modifier
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(Neutral400)
                        .padding(top = offset.dp),
                )
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Empty State
// ═══════════════════════════════════════════════════════════════════════

@Composable
private fun EmptyChatPlaceholder() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Surface(
                shape = CircleShape,
                color = PrimaryGreen.copy(alpha = 0.1f),
                modifier = Modifier.size(64.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Chat,
                        contentDescription = null,
                        tint = PrimaryGreen.copy(alpha = 0.5f),
                        modifier = Modifier.size(28.dp),
                    )
                }
            }
            Text(
                text = "Commencez la conversation",
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                color = TextSecondary,
            )
            Text(
                text = "Envoyez un message pour d\u00e9buter votre consultation",
                fontSize = 13.sp,
                color = TextTertiary,
                modifier = Modifier.padding(horizontal = 48.dp),
            )
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Chat Input Bar — NO duplicate call buttons. Has voice recording + media attachment.
// ═══════════════════════════════════════════════════════════════════════

@Composable
private fun ChatInputBar(
    messageText: String,
    onMessageTextChanged: (String) -> Unit,
    onSend: () -> Unit,
    isRecording: Boolean,
    recordingDuration: Int,
    onStartRecording: () -> Unit,
    onStopRecording: () -> Unit,
    onAttachMedia: () -> Unit,
) {
    Surface(
        color = Color.White,
        shadowElevation = 4.dp,
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, Neutral200),
    ) {
        if (isRecording) {
            // Recording mode UI
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Red pulsing indicator
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .clip(CircleShape)
                        .background(SanteDanger),
                )
                Spacer(modifier = Modifier.width(12.dp))
                Text(
                    text = String.format("%02d:%02d", recordingDuration / 60, recordingDuration % 60),
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Medium,
                    color = TextPrimary,
                    modifier = Modifier.weight(1f)
                )
                // Stop recording button
                Surface(
                    onClick = onStopRecording,
                    shape = CircleShape,
                    color = SanteDanger,
                    modifier = Modifier.size(42.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.Stop,
                            contentDescription = "Arr\u00eater",
                            tint = Color.White,
                            modifier = Modifier.size(22.dp),
                        )
                    }
                }
            }
        } else {
            // Normal input mode
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 6.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Attachment button
                IconButton(onClick = onAttachMedia, modifier = Modifier.size(42.dp)) {
                    Icon(
                        imageVector = Icons.Default.AttachFile,
                        contentDescription = "Joindre un m\u00e9dia",
                        tint = Neutral400,
                        modifier = Modifier.size(24.dp),
                    )
                }

                // Text field
                OutlinedTextField(
                    value = messageText,
                    onValueChange = onMessageTextChanged,
                    placeholder = {
                        Text(
                            "\u00c9crire un message...",
                            fontSize = 15.sp,
                            color = Neutral400,
                        )
                    },
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = 44.dp, max = 120.dp),
                    shape = RoundedCornerShape(22.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Color.Transparent,
                        unfocusedBorderColor = Color.Transparent,
                        cursorColor = PrimaryGreen,
                        unfocusedContainerColor = Neutral100,
                        focusedContainerColor = Neutral100,
                    ),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { onSend() }),
                    maxLines = 5,
                )

                // Send button (when text present) or Mic/voice recording (when empty)
                if (messageText.isNotBlank()) {
                    Spacer(modifier = Modifier.width(4.dp))
                    Surface(
                        onClick = onSend,
                        shape = CircleShape,
                        color = PrimaryGreen,
                        modifier = Modifier.size(42.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.Send,
                                contentDescription = "Envoyer",
                                tint = Color.White,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                } else {
                    // Mic button for voice recording
                    IconButton(onClick = onStartRecording, modifier = Modifier.size(42.dp)) {
                        Icon(
                            imageVector = Icons.Default.Mic,
                            contentDescription = "Enregistrer un message vocal",
                            tint = PrimaryGreen,
                            modifier = Modifier.size(24.dp),
                        )
                    }
                }
            }
        }
    }
}
