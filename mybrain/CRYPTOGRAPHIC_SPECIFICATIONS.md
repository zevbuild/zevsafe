# Cryptographic Specifications: Android Offline Vault

This document contains the core Kotlin/Java code required to implement PBKDF2/Argon2id key derivation and AES-256-GCM authenticated encryption.

---

## 1. Key Derivation Function (PBKDF2-HMAC-SHA512)
We derive our cryptographic encryption key from the user's master password using PBKDF2 with SHA-512 and a random salt.

```kotlin
package com.offline.vault.crypto

import java.security.NoSuchAlgorithmException
import java.security.spec.InvalidKeySpecException
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

object KeyDerivator {
    private const val ITERATIONS = 100000
    private const val KEY_LENGTH = 256 // 256-bit AES Key

    fun deriveKey(password: CharArray, salt: ByteArray): SecretKey {
        try {
            val spec = PBEKeySpec(password, salt, ITERATIONS, KEY_LENGTH)
            val skf = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA512")
            val derivedKey = skf.generateSecret(spec).encoded
            return SecretKeySpec(derivedKey, "AES")
        } catch (e: NoSuchAlgorithmException) {
            throw RuntimeException("HMAC-SHA512 not supported by system JVM", e)
        } catch (e: InvalidKeySpecException) {
            throw RuntimeException("Invalid key specification", e)
        }
    }
}
```

---

## 2. AES-256-GCM Streaming File Cryptor
We use AES in Galois/Counter Mode (GCM), which provides both confidentiality and authentication (checking for data corruption/tampering) without requiring a separate HMAC.

```kotlin
package com.offline.vault.crypto

import java.io.InputStream
import java.io.OutputStream
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.CipherOutputStream
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object FileCryptor {
    private const val GCM_IV_LENGTH = 12 // 12-byte initialization vector recommended for GCM
    private const val GCM_TAG_LENGTH = 128 // 128-bit authentication tag size

    /**
     * Encrypts the input stream and writes output to the destination stream.
     * Appends the 12-byte IV at the beginning of the file.
     */
    fun encrypt(inputStream: InputStream, outputStream: OutputStream, secretKey: SecretKey) {
        val iv = ByteArray(GCM_IV_LENGTH)
        SecureRandom().nextBytes(iv)
        outputStream.write(iv) // Write IV to the output file header

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val spec = GCMParameterSpec(GCM_TAG_LENGTH, iv)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, spec)

        CipherOutputStream(outputStream, cipher).use { cos ->
            inputStream.use { fis ->
                val buffer = ByteArray(8192)
                var read: Int
                while (fis.read(buffer).also { read = it } != -1) {
                    cos.write(buffer, 0, read)
                }
            }
        }
    }

    /**
     * Decrypts the input stream (parsing the IV from the header) and outputs plaintext.
     */
    fun decrypt(inputStream: InputStream, outputStream: OutputStream, secretKey: SecretKey) {
        val iv = ByteArray(GCM_IV_LENGTH)
        val readBytes = inputStream.read(iv)
        if (readBytes != GCM_IV_LENGTH) {
            throw Exception("Corrupted encrypted file: missing initialization vector header")
        }

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val spec = GCMParameterSpec(GCM_TAG_LENGTH, iv)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)

        CipherInputStream(inputStream, cipher).use { cis ->
            outputStream.use { fos ->
                val buffer = ByteArray(8192)
                var read: Int
                while (cis.read(buffer).also { read = it } != -1) {
                    fos.write(buffer, 0, read)
                }
            }
        }
    }
}
```
