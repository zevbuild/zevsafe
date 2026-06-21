# Project Plan: Android Offline External SD Card Vault

This document outlines the project structure, components, and libraries for building the air-gapped Android vault app.

---

## 1. Project Directory Structure
A clean Android Kotlin project layout designed to enforce strict boundary separations:

```text
app/
├── src/
│   ├── main/
│   │   ├── AndroidManifest.xml       <- Strict offline manifest (no internet permissions)
│   │   ├── java/com/offline/vault/
│   │   │   ├── api/                  <- Shizuku and System Binder interfaces
│   │   │   ├── crypto/               <- Key derivation and encryption (Tink/BouncyCastle)
│   │   │   ├── db/                   <- Local SQLite database (encrypted metadata)
│   │   │   ├── storage/              <- SD Card /Android/data/ directory routers
│   │   │   ├── ui/                   <- Jetpack Compose views
│   │   │   │   ├── components/       <- ExoPlayer/Glide secure RAM-only rendering
│   │   │   │   └── screens/          <- Lock screen, File Explorer, Camera
│   │   │   └── MainApplication.kt
│   │   └── res/
│   └── AndroidManifest.xml
├── build.gradle.kts                  <- App build configuration
└── settings.gradle.kts
```

---

## 2. Cryptographic & Core Libraries
Add the following dependencies to your `app/build.gradle.kts` file:

```kotlin
dependencies {
    // 1. Google Tink (Cryptographic Toolkit)
    implementation("com.google.crypto.tink:tink-android:1.12.0")

    // 2. BouncyCastle (Fallback and advanced algorithms like Argon2id)
    implementation("org.bouncycastle:bcprov-jdk18on:1.77")

    // 3. Shizuku API (Elevated ADB Storage access)
    implementation("dev.rikka.shizuku:api:13.1.5")
    implementation("dev.rikka.shizuku:provider:13.1.5")

    // 4. In-App Video Rendering (ExoPlayer)
    implementation("com.google.android.exoplayer:exoplayer:2.19.1")

    // 5. In-App Image Rendering (Glide)
    implementation("com.github.bumptech.glide:glide:4.16.0")
    ksp("com.github.bumptech.glide:ksp:4.16.0")

    // 6. SQLCipher (Encrypted Database for storing file structure metadata)
    implementation("net.zetetic:sqlcipher-android:4.5.4")
    implementation("androidx.sqlite:sqlite-ktx:2.4.0")
}
```

---

## 3. Strict Offline Configuration
To guarantee absolute security and air-gapped operation, the `AndroidManifest.xml` must not contain the `android.permission.INTERNET` permission.

### `app/src/main/AndroidManifest.xml`
```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.offline.vault">

    <!-- ONLY request local storage, camera, and biometric access -->
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.USE_BIOMETRIC" />

    <!-- 
      ATTENTION: Do NOT declare android.permission.INTERNET.
      This ensures the Android system physically blocks the application from 
      opening any sockets or transmitting data over the network.
    -->

    <application
        android:name=".MainApplication"
        android:allowBackup="false"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/Theme.Vault">
        
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:theme="@style/Theme.Vault">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```
