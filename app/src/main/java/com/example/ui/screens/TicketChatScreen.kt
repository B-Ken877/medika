package com.example.ui.screens

import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ui.SanteViewModel
import com.example.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TicketChatScreen(
    viewModel: SanteViewModel,
    onBack: () -> Unit
) {
    val ticket by viewModel.currentTicket.collectAsStateWithLifecycle()
    val messages by viewModel.currentTicketMessages.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    val context = LocalContext.current
    var messageText by remember { mutableStateOf("") }
    var isSending by remember { mutableStateOf(false) }

    // Auto-scroll to bottom when new messages arrive
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    // Show ticket errors as Toast
    val ticketError by viewModel.ticketError.collectAsStateWithLifecycle()
    LaunchedEffect(ticketError) {
        ticketError?.let { msg ->
            Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
            viewModel.clearTicketError()
        }
    }

    // Refresh every 5 seconds
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(5000)
            viewModel.refreshCurrentTicket()
        }
    }

    // File picker
    val fileLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) {
            isSending = true
            viewModel.uploadTicketFile(uri, context) { url, type, size ->
                if (url != null) {
                    viewModel.sendTicketMessage("", url, type, size)
                } else {
                    Toast.makeText(context, "Echec de l'envoi du fichier", Toast.LENGTH_SHORT).show()
                }
                isSending = false
            }
        }
    }

    val isClosed = (ticket?.get("status") as? String) == "closed"
    val subject = ticket?.get("subject") as? String ?: "Ticket"

    Box(modifier = Modifier.fillMaxSize().background(SanteBackground)) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Top bar
            Surface(color = Color.White, shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
                Column {
                    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = TextPrimary) }
                        Spacer(modifier = Modifier.weight(1f))
                        Text(subject, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold, color = TextPrimary), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Spacer(modifier = Modifier.weight(1f))
                        if (isClosed) {
                            Surface(shape = RoundedCornerShape(6.dp), color = Neutral200) {
                                Text("Fermé", modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Neutral500)
                            }
                        }
                    }
                    if (isClosed) {
                        Surface(color = Color(0xFFFFF7ED), modifier = Modifier.fillMaxWidth()) {
                            Text("Ce ticket est fermé. Vous ne pouvez plus envoyer de messages.", modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp), fontSize = 12.sp, color = Color(0xFF92400E), textAlign = TextAlign.Center, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }

            // Messages
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).padding(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                reverseLayout = false
            ) {
                items(messages, key = { it["id"] ?: "" }) { msg ->
                    val senderRole = msg["sender_role"] as? String ?: "user"
                    val isMe = senderRole == "user"
                    val content = msg["content"] as? String ?: ""
                    val fileUrl = msg["file_url"] as? String
                    val senderName = msg["sender_name"] as? String ?: ""
                    val createdAt = (msg["created_at"] as? Number)?.toLong() ?: 0

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = if (isMe) Arrangement.End else Arrangement.Start
                    ) {
                        Surface(
                            shape = RoundedCornerShape(
                                topStart = 16.dp, topEnd = 16.dp,
                                bottomStart = if (isMe) 16.dp else 4.dp,
                                bottomEnd = if (isMe) 4.dp else 16.dp
                            ),
                            color = if (isMe) PrimaryGreen else Neutral100,
                            modifier = Modifier.widthIn(max = 280.dp)
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text(
                                    senderName,
                                    fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                                    color = if (isMe) Color(0xCCFFFFFF) else Neutral500
                                )
                                if (content.isNotBlank()) {
                                    Text(content, fontSize = 14.sp, color = if (isMe) Color.White else TextPrimary, modifier = Modifier.padding(top = 2.dp))
                                }
                                if (fileUrl != null) {
                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = if (isMe) Color(0xCCFFFFFF) else Color.White,
                                        modifier = Modifier.padding(top = 6.dp).clickable {
                                            // Open file in browser
                                            android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://medikahaiti.site$fileUrl")).also {
                                                context.startActivity(it)
                                            }
                                        }
                                    ) {
                                        Row(modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                            Icon(Icons.Default.AttachFile, contentDescription = null, modifier = Modifier.size(14.dp), tint = if (isMe) PrimaryGreen else Color(0xFF3B82F6))
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Text("Voir le fichier", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = if (isMe) PrimaryGreen else Color(0xFF3B82F6))
                                        }
                                    }
                                }
                                if (createdAt > 0) {
                                    Text(
                                        formatTicketMsgTime(createdAt),
                                        fontSize = 10.sp, color = if (isMe) Color(0xAAFFFFFF) else Neutral400,
                                        modifier = Modifier.padding(top = 4.dp).align(androidx.compose.ui.Alignment.End)
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Input bar
            if (!isClosed) {
                Surface(color = Color.White, shadowElevation = 4.dp, modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.Bottom
                    ) {
                        IconButton(onClick = { fileLauncher.launch("*/*") }, modifier = Modifier.size(44.dp)) {
                            Icon(Icons.Default.AttachFile, contentDescription = "Joindre", tint = Neutral500, modifier = Modifier.size(22.dp))
                        }
                        OutlinedTextField(
                            value = messageText,
                            onValueChange = { messageText = it },
                            modifier = Modifier.weight(1f).heightIn(min = 44.dp, max = 120.dp),
                            placeholder = { Text("Écrire un message...") },
                            shape = RoundedCornerShape(22.dp),
                            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = PrimaryGreen, unfocusedBorderColor = Neutral200),
                            maxLines = 4
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        IconButton(
                            onClick = {
                                if (messageText.isNotBlank() && !isSending) {
                                    viewModel.sendTicketMessage(messageText.trim())
                                    messageText = ""
                                }
                            },
                            modifier = Modifier
                                .size(44.dp)
                                .background(if (messageText.isNotBlank()) PrimaryGreen else Neutral200, CircleShape),
                            enabled = messageText.isNotBlank() && !isSending
                        ) {
                            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Envoyer", tint = Color.White, modifier = Modifier.size(20.dp))
                        }
                    }
                }
            }
        }
    }
}

private fun formatTicketMsgTime(ts: Long): String {
    val sdf = java.text.SimpleDateFormat("HH:mm", java.util.Locale.FRANCE)
    return sdf.format(java.util.Date(ts * 1000))
}
