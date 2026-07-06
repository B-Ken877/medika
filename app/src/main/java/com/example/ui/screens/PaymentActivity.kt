package com.example.ui.screens

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.example.CrashLogger
import com.example.R
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class PaymentActivity : AppCompatActivity() {

    companion object {
        const val PAYMENT_SERVER = "http://167.86.124.101:9998"
        const val API_BASE = "http://167.86.124.101:3000/api"
        const val DEFAULT_PRICE = 750
        const val EXTRA_DOCTOR_NAME = "doctor_name"
        const val EXTRA_ORDER_ID = "order_id"
        const val EXTRA_PAYMENT_SUCCESS = "payment_success"
        const val EXTRA_TRANSACTION_ID = "transaction_id"
        const val EXTRA_SPECIALTY = "specialty"
        const val EXTRA_CONSULTATION_PRICE = "consultation_price"

        fun newIntent(context: Context, doctorName: String, orderId: String, specialty: String? = null): Intent {
            return Intent(context, PaymentActivity::class.java).apply {
                putExtra(EXTRA_DOCTOR_NAME, doctorName)
                putExtra(EXTRA_ORDER_ID, orderId)
                if (specialty != null) putExtra(EXTRA_SPECIALTY, specialty)
            }
        }
    }

    private lateinit var webView: WebView
    private lateinit var loadingContainer: LinearLayout
    private lateinit var verifyContainer: LinearLayout
    private lateinit var errorContainer: LinearLayout
    private lateinit var paymentInfoCard: LinearLayout
    private lateinit var errorText: TextView
    private var currentOrderId = ""
    private var consultationPrice = DEFAULT_PRICE
    private var specialty: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_payment)

        val doctorName = intent.getStringExtra(EXTRA_DOCTOR_NAME) ?: "Dr. Medecin"
        specialty = intent.getStringExtra(EXTRA_SPECIALTY)
        currentOrderId = intent.getStringExtra(EXTRA_ORDER_ID)
            ?: "MC_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}"

        findViewById<TextView>(R.id.doctorNameText).text = doctorName
        findViewById<TextView>(R.id.amountText).text = "Chargement..."
        findViewById<android.widget.ImageButton>(R.id.btnBack).setOnClickListener { setResult(RESULT_CANCELED); finish() }
        findViewById<Button>(R.id.btnRetry).setOnClickListener { createPayment() }

        webView = findViewById(R.id.paymentWebView)
        loadingContainer = findViewById(R.id.loadingContainer)
        verifyContainer = findViewById(R.id.verifyContainer)
        errorContainer = findViewById(R.id.errorContainer)
        paymentInfoCard = findViewById(R.id.paymentInfoCard)
        errorText = findViewById(R.id.errorText)

        setupWebView()

        // Long press on amount text to simulate sandbox payment (for testing only)
        val amountTv = findViewById<TextView>(R.id.amountText)
        amountTv.setOnLongClickListener {
            Toast.makeText(this, "MODE TEST: Paiement simule", Toast.LENGTH_SHORT).show()
            CrashLogger.log("[MONCASH] Sandbox test mode triggered - simulating success")
            paymentSuccess("SANDBOX_TEST_${System.currentTimeMillis()}")
            true
        }

        // Fetch specialty price then create payment
        fetchSpecialtyPrice()
    }

    private fun fetchSpecialtyPrice() {
        if (specialty.isNullOrBlank()) {
            consultationPrice = DEFAULT_PRICE
            findViewById<TextView>(R.id.amountText).text = "$consultationPrice HTG"
            createPayment()
            return
        }

        Thread {
            try {
                val encoded = java.net.URLEncoder.encode(specialty, "UTF-8")
                val url = URL("$API_BASE/specialties/price?specialty=$encoded")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "GET"
                conn.connectTimeout = 10000
                conn.readTimeout = 10000
                val code = conn.responseCode
                if (code == 200) {
                    val response = conn.inputStream.bufferedReader().readText()
                    val json = JSONObject(response)
                    consultationPrice = json.optInt("price", DEFAULT_PRICE)
                    CrashLogger.log("[PRICE] Fetched price for $specialty: $consultationPrice HTG")
                } else {
                    consultationPrice = DEFAULT_PRICE
                    CrashLogger.log("[PRICE] Failed to fetch price, using default: $DEFAULT_PRICE")
                }
                conn.disconnect()
            } catch (e: Exception) {
                consultationPrice = DEFAULT_PRICE
                CrashLogger.log("[PRICE] Error fetching price: ${e.message}, using default")
            }

            runOnUiThread {
                findViewById<TextView>(R.id.amountText).text = "$consultationPrice HTG"
                createPayment()
            }
        }.start()
    }

    // JavaScript to inject into MonCash pages to detect errors
    private val errorDetectionJs = """
    (function() {
        function checkForErrors() {
            var body = document.body ? document.body.innerText : '';
            var errorMsg = '';
            
            if (body.indexOf('does not exist') !== -1 || body.indexOf('n\\'existe pas') !== -1 || body.indexOf('invalide') !== -1) {
                errorMsg = 'SANDBOX_ERROR';
            } else if (body.indexOf('Transaction Id: 0') !== -1) {
                errorMsg = 'SANDBOX_ERROR';
            } else if (body.indexOf('expired') !== -1 || body.indexOf('expiree') !== -1) {
                errorMsg = 'EXPIRED';
            } else if (body.indexOf('erreur') !== -1 || body.indexOf('error') !== -1) {
                if (body.indexOf('identifiant') !== -1 || body.indexOf('identifier') !== -1) {
                    errorMsg = 'SANDBOX_ERROR';
                }
            }
            
            if (errorMsg) {
                console.log('MONCASH_ERROR_DETECTED:' + errorMsg);
            }
        }
        
        // Check every 1 second
        setInterval(checkForErrors, 1000);
        // Also check after DOM mutations
        var observer = new MutationObserver(function() { checkForErrors(); });
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }
        
        // Initial check
        setTimeout(checkForErrors, 500);
    })();
    """.trimIndent()

    private fun setupWebView() {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.loadWithOverviewMode = true
        webView.settings.useWideViewPort = true

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                val scheme = request.url.scheme ?: ""
                val host = request.url.host ?: ""
                CrashLogger.log("[MONCASH] WebView URL: $url")

                if (scheme == "medika") {
                    CrashLogger.log("[MONCASH] App scheme detected, verifying payment")
                    verifyPayment()
                    return true
                }

                if (host.isNotEmpty() && !host.contains("moncash") && !host.contains("digicel") && !host.contains("sandbox") && !host.contains("167.86.124.101")) {
                    CrashLogger.log("[MONCASH] External redirect detected, verifying payment")
                    verifyPayment()
                    return true
                }
                return false
            }

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                CrashLogger.log("[MONCASH] Page finished: $url")
                // Inject error detection script on MonCash pages
                if (url != null && (url.contains("moncash") || url.contains("digicel") || url.contains("sandbox"))) {
                    view.evaluateJavascript(errorDetectionJs, null)
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage?): Boolean {
                if (message != null && message.message().startsWith("MONCASH_ERROR_DETECTED:")) {
                    val errorType = message.message().substringAfter("MONCASH_ERROR_DETECTED:")
                    CrashLogger.log("[MONCASH] Error detected in WebView: $errorType")
                    runOnUiThread {
                        when (errorType) {
                            "SANDBOX_ERROR" -> {
                                showError(
                                    "Mode Test MonCash: Votre numero n'est pas enregistré " +
                                    "comme compte test. Appuyez longuement sur le montant pour " +
                                    "simuler un paiement réussi, ou contactez Digicel pour activer " +
                                    "le mode production."
                                )
                            }
                            "EXPIRED" -> {
                                showError("La session de paiement a expiré. Veuillez réessayer.")
                            }
                            else -> {
                                showError("Erreur de paiement détectée. Veuillez réessayer.")
                            }
                        }
                    }
                }
                return true
            }
        }
    }

    private fun createPayment() {
        loadingContainer.visibility = android.view.View.VISIBLE
        webView.visibility = android.view.View.GONE
        verifyContainer.visibility = android.view.View.GONE
        errorContainer.visibility = android.view.View.GONE
        paymentInfoCard.visibility = android.view.View.VISIBLE

        Thread {
            try {
                val json = JSONObject()
                json.put("orderId", currentOrderId)
                json.put("amount", consultationPrice)
                val postData = json.toString()
                val url = URL("$PAYMENT_SERVER/api/payment/create")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                conn.outputStream.write(postData.toByteArray())
                conn.outputStream.flush()
                val code = conn.responseCode
                CrashLogger.log("[MONCASH] Create payment HTTP $code for $consultationPrice HTG")
                if (code == 200) {
                    val response = conn.inputStream.bufferedReader().readText()
                    val respJson = JSONObject(response)
                    if (respJson.optBoolean("success", false)) {
                        val redirectUrl = respJson.getString("redirectUrl")
                        CrashLogger.log("[MONCASH] Got redirect URL, loading WebView")
                        runOnUiThread {
                            loadingContainer.visibility = android.view.View.GONE
                            webView.visibility = android.view.View.VISIBLE
                            webView.loadUrl(redirectUrl)
                        }
                    } else {
                        showError("Erreur de creation de paiement")
                    }
                } else {
                    val errBody = conn.errorStream?.bufferedReader()?.readText() ?: "HTTP $code"
                    CrashLogger.log("[MONCASH] Error: $errBody")
                    showError("Erreur serveur: $code")
                }
                conn.disconnect()
            } catch (e: Exception) {
                CrashLogger.log("[MONCASH] Exception: ${e.message}")
                runOnUiThread { showError("Erreur: ${e.localizedMessage}") }
            }
        }.start()
    }

    private fun verifyPayment() {
        runOnUiThread {
            webView.visibility = android.view.View.GONE
            verifyContainer.visibility = android.view.View.VISIBLE
            paymentInfoCard.visibility = android.view.View.GONE
        }
        Thread {
            try {
                Thread.sleep(2000)
                val json = JSONObject()
                json.put("orderId", currentOrderId)
                val postData = json.toString()
                val url = URL("$PAYMENT_SERVER/api/payment/verify")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                conn.outputStream.write(postData.toByteArray())
                conn.outputStream.flush()
                val response = conn.inputStream.bufferedReader().readText()
                conn.disconnect()
                val respJson = JSONObject(response)
                CrashLogger.log("[MONCASH] Verify: $response")
                if (respJson.optBoolean("success", false)) {
                    val payment = respJson.getJSONObject("payment")
                    val status = payment.optString("status", "failed")
                    val txId = payment.optString("transactionId", "")
                    if (status == "completed") {
                        CrashLogger.log("[MONCASH] SUCCESS txId=$txId")
                        runOnUiThread { paymentSuccess(txId) }
                    } else {
                        runOnUiThread { showError("Paiement non complete: $status") }
                    }
                } else {
                    runOnUiThread { showError("Paiement non trouve") }
                }
            } catch (e: Exception) {
                CrashLogger.log("[MONCASH] Verify error: ${e.message}")
                runOnUiThread { showError("Erreur de verification") }
            }
        }.start()
    }

    private fun paymentSuccess(transactionId: String) {
        val resultIntent = Intent().apply {
            putExtra(EXTRA_PAYMENT_SUCCESS, true)
            putExtra(EXTRA_TRANSACTION_ID, transactionId)
            putExtra(EXTRA_ORDER_ID, currentOrderId)
            putExtra(EXTRA_CONSULTATION_PRICE, consultationPrice)
        }
        setResult(RESULT_OK, resultIntent)
        Toast.makeText(this, "Paiement reussi!", Toast.LENGTH_SHORT).show()
        finish()
    }

    private fun showError(message: String) {
        errorText.text = message
        loadingContainer.visibility = android.view.View.GONE
        webView.visibility = android.view.View.GONE
        verifyContainer.visibility = android.view.View.GONE
        errorContainer.visibility = android.view.View.VISIBLE
    }
}
