# Storage Routing & Shizuku API Integration

This document contains the implementation code for routing file operations to the external SD card app sandbox (`/Android/data/`) and utilizing Shizuku elevated privileges.

---

## 1. Locating App-Specific SD Card Sandbox Paths
Because standard Storage Access Framework (SAF) is extremely slow, we use Android's native API to find our package directory on any connected external MicroSD cards. Writing here bypasses SAF limitations entirely.

```kotlin
package com.offline.vault.storage

import android.content.Context
import android.os.Environment
import java.io.File

object StorageRouter {
    /**
     * Resolves the app-specific folder paths on all external storage devices (including MicroSD).
     * Typically returns paths like: /storage/[SD-CARD-UUID]/Android/data/com.offline.vault/files/
     */
    fun getExternalSdCardPaths(context: Context): List<File> {
        val externalDirs = context.getExternalFilesDirs(null)
        val sdCardPaths = mutableListOf<File>()

        for (dir in externalDirs) {
            if (dir != null) {
                // If the path is not part of the primary emulation storage, it is an SD card or external drive
                if (Environment.isExternalStorageRemovable(dir)) {
                    sdCardPaths.add(dir)
                }
            }
        }
        return sdCardPaths
    }
}
```

---

## 2. Shizuku API Permission & Binding Connection
Shizuku allows our offline app to invoke the Android `adb` shell locally. This grants us full native filesystem access to write vaults directly to the root of the SD card.

```kotlin
package com.offline.vault.api

import android.content.pm.PackageManager
import dev.rikka.shizuku.Shizuku
import dev.rikka.shizuku.ShizukuProvider
import java.io.BufferedReader
import java.io.InputStreamReader

object ShizukuManager {
    private const val REQUEST_CODE = 1001

    fun isShizukuAvailable(): Boolean {
        return Shizuku.pingBinder()
    }

    fun hasPermission(): Boolean {
        if (!isShizukuAvailable()) return false
        return Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
    }

    fun requestShizukuPermission(activity: androidx.activity.ComponentActivity) {
        if (isShizukuAvailable() && !hasPermission()) {
            Shizuku.requestPermission(REQUEST_CODE)
        }
    }

    /**
     * Runs a shell command on the SD card root using Shizuku binder.
     * Example: List root directory of SD card at /storage/XXXX-XXXX/
     */
    fun executeShellCommand(command: String): String {
        if (!hasPermission()) {
            throw Exception("Shizuku binder permissions not granted.")
        }

        val process = Shizuku.newProcess(arrayOf("sh", "-c", command), null, null)
        val reader = BufferedReader(InputStreamReader(process.inputStream))
        val output = StringBuilder()
        var line: String?
        while (reader.readLine().also { line = it } != null) {
            output.append(line).append("\n")
        }
        process.waitFor()
        return output.toString()
    }
}
```
