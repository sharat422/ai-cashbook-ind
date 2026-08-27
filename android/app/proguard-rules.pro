# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# ---------------------------------------------------------------------------
# R8/ProGuard keep rules for this app's native modules (minifyEnabled=true).
# Most RN libraries ship their own consumer rules; these are defensive keeps
# for reflection-driven paths. If a release build crashes with a
# ClassNotFound/NoSuchMethod after enabling R8, add the offending package here.
# ---------------------------------------------------------------------------

# --- React Native core + Hermes (New Architecture / Fabric is enabled) ---
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep @com.facebook.proguard.annotations.DoNotStrip class * { *; }
-keepclassmembers class * { @com.facebook.proguard.annotations.DoNotStrip *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.jni.** { *; }
-dontwarn com.facebook.react.**

# --- react-native-reanimated ---
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.core.CallInvokerHolderImpl { *; }

# --- react-native-screens ---
-keep class com.swmansion.rnscreens.** { *; }

# --- react-native-svg ---
-keep public class com.horcrux.svg.** { *; }

# --- react-native-config (BuildConfig fields read reflectively) ---
-keep class com.aismartcashbook.BuildConfig { *; }

# --- react-native-image-picker ---
-keep class com.imagepicker.** { *; }

# --- react-native-fs / html-to-pdf / share (file + intent bridges) ---
-keep class com.rnfs.** { *; }
-keep class com.christopherdro.htmltopdf.** { *; }
-keep class cl.json.** { *; }

# --- OkHttp / Okio (RN networking stack; used by fetch + any cert pinning) ---
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }

# --- react-native-keychain (Android Keystore-backed secure storage) ---
-keep class com.oblador.keychain.** { *; }

# --- jail-monkey (root/jailbreak detection) ---
-keep class com.gantman.reactnative.** { *; }

# Keep JS-facing native module method annotations.
-keepclassmembers class * { @com.facebook.react.bridge.ReactMethod <methods>; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.ReactProp <methods>; }
