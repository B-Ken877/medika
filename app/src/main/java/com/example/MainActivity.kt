package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModelProvider
import com.example.data.db.SanteDatabase
import com.example.data.repository.SanteRepository
import com.example.ui.SanteApp
import com.example.ui.SanteViewModel
import com.example.ui.SanteViewModelFactory
import com.example.ui.theme.SanteTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val database = SanteDatabase.getDatabase(this)
        val repository = SanteRepository(database.santeDao())

        val factory = SanteViewModelFactory(application, repository)
        val viewModel = ViewModelProvider(this, factory)[SanteViewModel::class.java]

        setContent {
            SanteTheme {
                // Scaffold applies the system bar insets (status bar at top,
                // navigation bar at bottom) as inner padding so the app content
                // sits BELOW the status bar and ABOVE the nav bar — never
                // drawing behind either of them.
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    SanteApp(
                        viewModel = viewModel,
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(innerPadding)
                    )
                }
            }
        }
    }
}
