package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.HeadsetMic
import androidx.compose.material.icons.filled.MarkChatUnread
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ui.SanteViewModel
import com.example.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TicketListScreen(
    viewModel: SanteViewModel,
    onNavigate: (String) -> Unit,
    onBack: () -> Unit
) {
    val tickets by viewModel.tickets.collectAsStateWithLifecycle()
    val loading by viewModel.ticketLoading.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { viewModel.fetchTickets() }

    var showNewTicketDialog by remember { mutableStateOf(false) }
    var newSubject by remember { mutableStateOf("") }

    Box(modifier = Modifier.fillMaxSize().background(SanteBackground)) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Top bar
            Surface(
                color = Color.White,
                shadowElevation = 1.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null, tint = TextPrimary)
                    }
                    Spacer(modifier = Modifier.weight(1f))
                    Text("Service Client", style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold, color = TextPrimary))
                    Spacer(modifier = Modifier.weight(1f))
                    IconButton(onClick = { showNewTicketDialog = true }) {
                        Icon(Icons.Default.Add, contentDescription = "Nouveau ticket", tint = PrimaryGreen)
                    }
                }
            }

            if (loading && tickets.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = PrimaryGreen)
                }
            } else if (tickets.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.HeadsetMic, contentDescription = null, modifier = Modifier.size(64.dp), tint = Neutral300)
                        Spacer(modifier = Modifier.height(16.dp))
                        Text("Aucun ticket", style = MaterialTheme.typography.bodyLarge, color = TextSecondary)
                        Text("Touchez + pour ouvrir un ticket", style = MaterialTheme.typography.bodyMedium, color = Neutral400)
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(tickets, key = { it["id"] ?: "" }) { ticket ->
                        val status = ticket["status"] as? String ?: "open"
                        val subject = ticket["subject"] as? String ?: ""
                        val userName = ticket["user_name"] as? String ?: ""
                        val lastMsg = ticket["last_message"] as? String
                        val unread = ticket["unread_count"] as? Int ?: 0
                        val updatedAt = (ticket["updated_at"] as? Number)?.toLong() ?: 0

                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = Color.White,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    viewModel.openTicket(ticket["id"] as? String ?: return@clickable)
                                    onNavigate("ticket_chat")
                                }
                        ) {
                            Row(
                                modifier = Modifier.padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                // Icon
                                Surface(shape = CircleShape, color = if (status == "open") Green100 else Neutral100) {
                                    Box(modifier = Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                                        Icon(
                                            Icons.Default.MarkChatUnread,
                                            contentDescription = null,
                                            modifier = Modifier.size(22.dp),
                                            tint = if (status == "open") PrimaryGreen else Neutral400
                                        )
                                    }
                                }
                                Spacer(modifier = Modifier.width(12.dp))

                                Column(modifier = Modifier.weight(1f)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            text = subject,
                                            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold, color = TextPrimary),
                                            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f)
                                        )
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Surface(
                                            shape = RoundedCornerShape(6.dp),
                                            color = if (status == "open") Green100 else Neutral200
                                        ) {
                                            Text(
                                                if (status == "open") "Ouvert" else "Fermé",
                                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                                fontSize = 11.sp,
                                                fontWeight = FontWeight.SemiBold,
                                                color = if (status == "open") Green700 else Neutral500
                                            )
                                        }
                                    }
                                    Spacer(modifier = Modifier.height(4.dp))
                                    if (lastMsg != null) {
                                        Text(
                                            text = lastMsg,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = TextSecondary,
                                            maxLines = 1, overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                    if (updatedAt > 0) {
                                        Text(
                                            text = formatTicketTime(updatedAt),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = Neutral400,
                                            modifier = Modifier.padding(top = 2.dp)
                                        )
                                    }
                                }

                                if (unread > 0) {
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Surface(shape = CircleShape, color = Color(0xFFEF4444)) {
                                        Text(
                                            "$unread",
                                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                            fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.White
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // New ticket dialog
        if (showNewTicketDialog) {
            AlertDialog(
                onDismissRequest = { showNewTicketDialog = false },
                containerColor = Color.White,
                shape = RoundedCornerShape(20.dp),
                title = { Text("Nouveau Ticket", fontWeight = FontWeight.Bold, color = TextPrimary) },
                text = {
                    OutlinedTextField(
                        value = newSubject,
                        onValueChange = { newSubject = it },
                        label = { Text("Sujet") },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = PrimaryGreen, focusedLabelColor = PrimaryGreen)
                    )
                },
                confirmButton = {
                    TextButton(onClick = {
                        if (newSubject.isNotBlank()) {
                            viewModel.createTicket(newSubject.trim()) { success, ticketId ->
                                if (success && ticketId != null) {
                                    showNewTicketDialog = false
                                    newSubject = ""
                                    viewModel.openTicket(ticketId)
                                    onNavigate("ticket_chat")
                                }
                            }
                        }
                    }) { Text("Envoyer", color = PrimaryGreen, fontWeight = FontWeight.SemiBold) }
                },
                dismissButton = {
                    TextButton(onClick = { showNewTicketDialog = false; newSubject = "" }) {
                        Text("Annuler", color = TextSecondary)
                    }
                }
            )
        }
    }
}

private fun formatTicketTime(ts: Long): String {
    val now = System.currentTimeMillis() / 1000
    val diff = now - ts
    return when {
        diff < 60 -> "À l\'instant"
        diff < 3600 -> "${diff / 60} min"
        diff < 86400 -> "${diff / 3600}h"
        diff < 604800 -> "${diff / 86400}j"
        else -> {
            val sdf = java.text.SimpleDateFormat("dd/MM", java.util.Locale.FRANCE)
            sdf.format(java.util.Date(ts * 1000))
        }
    }
}
