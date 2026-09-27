package com.rakazo.voice

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RakazoVoiceModule : Module() {
  private var recognizer: SpeechRecognizer? = null
  private var generation = 0
  override fun definition() = ModuleDefinition {
    Name("RakazoVoice")
    Events("transcript", "error", "listening")
    AsyncFunction("available") {
      val context = appContext.reactContext ?: throw IllegalStateException("App not ready")
      mapOf("available" to SpeechRecognizer.isRecognitionAvailable(context), "onDevice" to (Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)))
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("start") { sessionId: Int, locale: String, onDevice: Boolean ->
      val context = appContext.reactContext ?: throw IllegalStateException("App not ready")
      generation++
      val current = generation
      recognizer?.cancel()
      recognizer?.destroy()
      recognizer = null
      if (onDevice) require(Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) { "On-device recognition is unavailable" }
      val speech = if (onDevice && Build.VERSION.SDK_INT >= 31) SpeechRecognizer.createOnDeviceSpeechRecognizer(context) else SpeechRecognizer.createSpeechRecognizer(context)
      recognizer = speech
      speech.setRecognitionListener(object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) { if (current == generation) sendEvent("listening", mapOf("sessionId" to sessionId)) }
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onError(error: Int) { if (current == generation) sendEvent("error", mapOf("sessionId" to sessionId, "code" to error)) }
        override fun onResults(results: Bundle?) { if (current == generation) sendEvent("transcript", mapOf("sessionId" to sessionId, "text" to (results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""), "final" to true)) }
        override fun onPartialResults(results: Bundle?) { if (current == generation) sendEvent("transcript", mapOf("sessionId" to sessionId, "text" to (results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""), "final" to false)) }
        override fun onEvent(eventType: Int, params: Bundle?) {}
      })
      speech.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
        if (onDevice) putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      })
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("stop") { recognizer?.stopListening() }.runOnQueue(Queues.MAIN)
    AsyncFunction("cancel") { generation++; recognizer?.cancel(); recognizer?.destroy(); recognizer = null }.runOnQueue(Queues.MAIN)
    OnDestroy { generation++; Handler(Looper.getMainLooper()).post { recognizer?.destroy(); recognizer = null } }
  }
}
