<#
.SYNOPSIS
    Secure Folder Decryption Utility (Drag-and-Drop enabled)
#>

param(
    [string]$encPath
)

Add-Type -AssemblyName System.IO.Compression.FileSystem

# 1. Inputs
if ([string]::IsNullOrEmpty($encPath)) {
    $encPath = Read-Host -Prompt "Enter the absolute path of the .enc file to decrypt (or drag and drop it here)"
}

# Clean surrounding quotes (often added by Windows drag-and-drop or paths with spaces)
$encPath = $encPath.Trim('"', "'").Trim()

if (-not (Test-Path $encPath -PathType Leaf)) {
    Write-Host "Error: The specified file does not exist: $encPath" -ForegroundColor Red
    Exit
}

$encPath = (Get-Item $encPath).FullName
$parentDir = Split-Path $encPath -Parent
$fileName = Split-Path $encPath -Leaf
$folderName = $fileName -replace "\.enc$", ""
$targetFolder = Join-Path $parentDir $folderName

# Check if target folder already exists to prevent overwriting
if (Test-Path $targetFolder) {
    $targetFolder = Join-Path $parentDir "$folderName`_Decrypted"
    Write-Host "Warning: Folder '$folderName' already exists. Extracting to '$folderName`_Decrypted' instead." -ForegroundColor Yellow
}

$password = Read-Host -Prompt "Enter the password to decrypt" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
$plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

Write-Host "Reading encrypted file..." -ForegroundColor Cyan
$allBytes = [System.IO.File]::ReadAllBytes($encPath)

if ($allBytes.Length -lt 48) {
    Write-Host "Error: File is too small to be a valid encrypted vault or is corrupted." -ForegroundColor Red
    Exit
}

# Parse Salt (16 bytes), MAC (32 bytes), and Ciphertext (remaining)
$salt = New-Object byte[] 16
$mac = New-Object byte[] 32
$ciphertext = New-Object byte[] ($allBytes.Length - 48)

[System.Buffer]::BlockCopy($allBytes, 0, $salt, 0, 16)
[System.Buffer]::BlockCopy($allBytes, 16, $mac, 0, 32)
[System.Buffer]::BlockCopy($allBytes, 48, $ciphertext, 0, $ciphertext.Length)

Write-Host "Verifying password and data integrity..." -ForegroundColor Cyan

# Derive Key, IV, and HMAC Key using the Salt
$hashAlg = [System.Security.Cryptography.HashAlgorithmName]::SHA256
$pbkdf2 = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($plainPassword, $salt, 100000, $hashAlg)
$keyBytes = $pbkdf2.GetBytes(32)
$ivBytes = $pbkdf2.GetBytes(16)
$hmacKeyBytes = $pbkdf2.GetBytes(32)

# Calculate HMAC over Salt + Ciphertext
$hmac = New-Object System.Security.Cryptography.HMACSHA256(,$hmacKeyBytes)
$macInput = New-Object byte[] ($salt.Length + $ciphertext.Length)
[System.Buffer]::BlockCopy($salt, 0, $macInput, 0, $salt.Length)
[System.Buffer]::BlockCopy($ciphertext, 0, $macInput, $salt.Length, $ciphertext.Length)
$computedMac = $hmac.ComputeHash($macInput)

# Secure comparison (compare signatures)
$verified = $true
for ($i = 0; $i -lt 32; $i++) {
    if ($mac[$i] -ne $computedMac[$i]) {
        $verified = $false
    }
}

if (-not $verified) {
    Write-Host "Error: Decryption failed! Incorrect password or the file has been tampered with/corrupted." -ForegroundColor Red
    $pbkdf2.Dispose()
    $hmac.Dispose()
    Exit
}

Write-Host "Password verified! Decrypting data..." -ForegroundColor Cyan

# Decrypt ciphertext using AES-256
$aes = [System.Security.Cryptography.Aes]::Create()
$aes.Key = $keyBytes
$aes.IV = $ivBytes
$decryptor = $aes.CreateDecryptor()
$zipBytes = $decryptor.TransformFinalBlock($ciphertext, 0, $ciphertext.Length)

# Write to temp zip file
$tempZipPath = [System.IO.Path]::GetTempFileName()
Remove-Item $tempZipPath -Force -ErrorAction SilentlyContinue
[System.IO.File]::WriteAllBytes($tempZipPath, $zipBytes)

# Extract Zip
Write-Host "Extracting folder contents..." -ForegroundColor Cyan
[System.IO.Compression.ZipFile]::ExtractToDirectory($tempZipPath, $targetFolder)

# Cleanup
$pbkdf2.Dispose()
$aes.Dispose()
$hmac.Dispose()
Remove-Item $tempZipPath -Force -ErrorAction SilentlyContinue

Write-Host "Success! Folder has been fully decrypted and restored." -ForegroundColor Green
Write-Host "Restored Location: $targetFolder" -ForegroundColor Green
