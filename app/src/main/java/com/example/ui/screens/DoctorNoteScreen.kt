package com.example.ui.screens

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.api.PrescriptionItem
import com.example.data.api.SaveConsultationNoteRequest
import com.example.ui.SanteViewModel
import com.example.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DoctorNoteScreen(
    viewModel: SanteViewModel,
    onBack: () -> Unit = {},
) {
    val context = LocalContext.current
    var diagnosis by remember { mutableStateOf("") }
    var symptoms by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var followUp by remember { mutableStateOf("") }
    var prescriptions by remember { mutableStateOf(mutableListOf<PrescriptionItem>()) }
    var isSaving by remember { mutableStateOf(false) }
    var showRxDialog by remember { mutableStateOf(false) }

    // Rx dialog state
    var rxMedication by remember { mutableStateOf("") }
    var rxDosage by remember { mutableStateOf("") }
    var rxDuration by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = PrimaryGreen,
                    titleContentColor = Color.White,
                ),
                title = {
                    Text(
                        "Notes de Consultation",
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Retour",
                            tint = Color.White
                        )
                    }
                },
                actions = {
                    if (!isSaving) {
                        IconButton(onClick = {
                            isSaving = true
                            val request = SaveConsultationNoteRequest(
                                diagnosis = diagnosis.trim(),
                                symptoms = symptoms.trim(),
                                notes = notes.trim(),
                                prescriptions = prescriptions.toList(),
                                followUp = followUp.trim()
                            )
                            viewModel.saveConsultationNote(request) { success, error ->
                                isSaving = false
                                if (success) {
                                    Toast.makeText(context, "Notes enregistrees!", Toast.LENGTH_SHORT).show()
                                    onBack()
                                } else {
                                    Toast.makeText(context, "Erreur: ${error ?: "inconnue"}", Toast.LENGTH_LONG).show()
                                }
                            }
                        }) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = "Enregistrer",
                                tint = Color.White
                            )
                        }
                    } else {
                        CircularProgressIndicator(
                            modifier = Modifier
                                .padding(horizontal = 16.dp)
                                .size(24.dp),
                            color = Color.White,
                            strokeWidth = 2.dp
                        )
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Diagnosis
            OutlinedTextField(
                value = diagnosis,
                onValueChange = { diagnosis = it },
                label = { Text("Diagnostic") },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = PrimaryGreen,
                    focusedLabelColor = PrimaryGreen
                )
            )

            // Symptoms
            OutlinedTextField(
                value = symptoms,
                onValueChange = { symptoms = it },
                label = { Text("Symptomes observes") },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                minLines = 3,
                maxLines = 5,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = PrimaryGreen,
                    focusedLabelColor = PrimaryGreen
                )
            )

            // Notes
            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                label = { Text("Notes du medecin") },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                minLines = 3,
                maxLines = 5,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = PrimaryGreen,
                    focusedLabelColor = PrimaryGreen
                )
            )

            // Follow-up
            OutlinedTextField(
                value = followUp,
                onValueChange = { followUp = it },
                label = { Text("Suivi recommande") },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = PrimaryGreen,
                    focusedLabelColor = PrimaryGreen
                )
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Prescriptions section
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Ordonnance",
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                )
                FilledTonalButton(
                    onClick = { showRxDialog = true },
                    colors = ButtonDefaults.filledTonalButtonColors(
                        containerColor = PrimaryGreen.copy(alpha = 0.1f),
                        contentColor = PrimaryGreen
                    )
                ) {
                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Ajouter")
                }
            }

            if (prescriptions.isEmpty()) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Neutral100),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(
                        "Aucun medicament prescrit",
                        modifier = Modifier.padding(16.dp),
                        color = TextTertiary
                    )
                }
            } else {
                prescriptions.forEachIndexed { index, rx ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = Color.White),
                        shape = RoundedCornerShape(12.dp),
                        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    rx.medication,
                                    fontWeight = FontWeight.SemiBold,
                                    color = TextPrimary
                                )
                                if (rx.dosage.isNotBlank()) {
                                    Text(
                                        rx.dosage,
                                        fontSize = 13.sp,
                                        color = TextSecondary
                                    )
                                }
                                if (rx.duration.isNotBlank()) {
                                    Text(
                                        "Duree: ${rx.duration}",
                                        fontSize = 12.sp,
                                        color = TextTertiary
                                    )
                                }
                            }
                            IconButton(onClick = {
                                prescriptions = prescriptions.toMutableList().also { it.removeAt(index) }
                            }) {
                                Icon(
                                    Icons.Default.Delete,
                                    contentDescription = "Supprimer",
                                    tint = SanteDanger
                                )
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }

    // Add Prescription Dialog
    if (showRxDialog) {
        AlertDialog(
            onDismissRequest = { showRxDialog = false },
            title = { Text("Ajouter un medicament", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = rxMedication,
                        onValueChange = { rxMedication = it },
                        label = { Text("Medicament *") },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                        singleLine = true
                    )
                    OutlinedTextField(
                        value = rxDosage,
                        onValueChange = { rxDosage = it },
                        label = { Text("Posologie") },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                        singleLine = true,
                        placeholder = { Text("ex: 1 comprime 3x/jour") }
                    )
                    OutlinedTextField(
                        value = rxDuration,
                        onValueChange = { rxDuration = it },
                        label = { Text("Duree") },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                        singleLine = true,
                        placeholder = { Text("ex: 7 jours") }
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (rxMedication.isNotBlank()) {
                            prescriptions = prescriptions.toMutableList().also {
                                it.add(PrescriptionItem(
                                    medication = rxMedication.trim(),
                                    dosage = rxDosage.trim(),
                                    duration = rxDuration.trim()
                                ))
                            }
                            rxMedication = ""
                            rxDosage = ""
                            rxDuration = ""
                            showRxDialog = false
                        }
                    },
                    enabled = rxMedication.isNotBlank()
                ) {
                    Text("Ajouter", color = PrimaryGreen, fontWeight = FontWeight.SemiBold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showRxDialog = false }) {
                    Text("Annuler", color = Color.Gray)
                }
            },
            shape = RoundedCornerShape(16.dp)
        )
    }
}
