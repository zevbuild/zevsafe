# SD Card Cross-Platform Offline Encryption Guide

This document describes how to use your SD card as a portable, secure encrypted storage vault across both Windows PCs and Android devices, without using any internet data.

---

## 1. Portable Setup on Windows PC

To prepare your MicroSD card for secure portable data storage:

1. Insert your MicroSD card into your Windows PC.
2. Open Windows File Explorer and check the drive letter assigned to your SD card (e.g. `D:` or `E:`).
3. Create a folder named **`the-system`** on the root of your SD card.
4. Copy the following files from your PC workspace (`C:\Users\Raju\Desktop\the-system`) into the new `the-system` folder on your SD card:
   * **`encrypt.ps1`** (Streaming AES-256 script)
   * **`decrypt.ps1`** (Decryption verification script)
   * **`how to use this encryption.txt`** (Quickstart manual)
5. You can now copy `Encrypt Folder.bat` and `Decrypt Folder.bat` from your Desktop to the root of the SD card.
   * Edit the `.bat` files with Notepad to change the path parameter from `C:\Users\Raju\Desktop\the-system\...` to `.\the-system\...` so they can run relatively from any computer.

---

## 2. Encrypting Files on the SD Card (PC Side)
To encrypt any folder directly on the SD card using your PC:
1. Open your SD card directory in File Explorer.
2. Drag and drop any folder on the SD card onto **`Encrypt Folder.bat`**.
3. Choose a strong password.
4. The tool will stream the folder into a secure `.enc` file directly on the SD card.
5. You can then delete the original folder on the SD card to leave only the encrypted vault.

---

## 3. Managing the Vault on Android
Once your folder is encrypted as a `.enc` file on the SD card, you can insert the card into your Android device:

1. **Portable Storage**: Keep the SD card formatted as "Portable Storage" (FAT32/exFAT). Do not format it as "Internal/Adoptable Storage" or it will be locked exclusively to that phone.
2. **Accessing the Encrypted File**:
   * **Standard Mode**: Open the Offline Vault Android App. Navigate to your SD card's App sandbox:
     `/storage/[SD-UUID]/Android/data/com.offline.vault/files/`
     Copy your `.enc` files here. The app will read them at native speeds, verify the HMAC, decrypt the zip stream in RAM, and play/display your videos and images directly inside the app without saving them to the phone's unencrypted storage.
   * **Shizuku Mode**: Activate the Shizuku app on Android (via wireless debugging). Grant the Vault app Shizuku permissions. You can now keep your `.enc` vaults directly in the root directory of the SD card and decrypt them from anywhere without transferring them.
