package com.aismartcashbook

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager

class VoicePcmPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(VoicePcmModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

/** 24 kHz mono PCM16, delivered as roughly 80 ms microphone frames. */
class VoicePcmModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  @Volatile private var running = false
  private var recorder: AudioRecord? = null
  private var worker: Thread? = null
  init { context.addLifecycleEventListener(this) }

  override fun getName() = "VoicePcm"
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  private fun emit(name: String, value: String) {
    if (context.hasActiveReactInstance()) {
      context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, value)
    }
  }

  @Synchronized @ReactMethod
  fun start(promise: Promise) {
    if (recorder != null) {
      promise.reject("BUSY", "Microphone is already active.")
      return
    }
    try {
      val minimum = AudioRecord.getMinBufferSize(24000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      check(minimum > 0) { "24 kHz microphone capture is unavailable." }
      val audio = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 24000,
        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minimum, 3840 * 3))
      recorder = audio
      check(audio.state == AudioRecord.STATE_INITIALIZED) { "Microphone initialization failed." }
      audio.startRecording()
      check(audio.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Microphone could not start." }
      running = true
      worker = Thread({
        val frame = ByteArray(3840)
        try {
          while (running) {
            val count = audio.read(frame, 0, frame.size, AudioRecord.READ_BLOCKING)
            if (count > 0) emit("voicePcmData", Base64.encodeToString(frame, 0, count, Base64.NO_WRAP))
            else if (running) throw IllegalStateException("Microphone read failed: $count")
          }
        } catch (error: Exception) {
          if (running) emit("voicePcmError", "Microphone capture was interrupted.")
        } finally {
          running = false
        }
      }, "cashbook-voice")
      worker!!.start()
      promise.resolve(null)
    } catch (error: Exception) {
      running = false
      recorder?.release()
      recorder = null
      promise.reject("MICROPHONE", error.message, error)
    }
  }

  @Synchronized private fun release() {
    running = false
    try { recorder?.stop() } catch (_: IllegalStateException) {}
    // stop unblocks read; joining ensures all emitted frames precede the stop result.
    worker?.join(1000)
    worker = null
    recorder?.release()
    recorder = null
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      release()
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("MICROPHONE", error.message, error)
    }
  }

  override fun invalidate() {
    release()
    context.removeLifecycleEventListener(this)
    super.invalidate()
  }

  override fun onHostResume() {}
  override fun onHostPause() {
    if (running) {
      emit("voicePcmError", "Recording stopped when the app left the foreground.")
      release()
    }
  }
  override fun onHostDestroy() { release() }
}
