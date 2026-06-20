<#
.SYNOPSIS
    Secure Folder Encryption Utility (Drag-and-Drop enabled)
#>

param(
    [string]$folderPath
)

Add-Type -AssemblyName System.IO.Compression.FileSystem

# 1. Inputs
if ([string]::IsNullOrEmpty($folderPath)) {
    $folderPath = Read-Host -Prompt "Enter the absolute path of the folder to encrypt (or drag and drop it here)"
}

# Clean surrounding quotes (often added by Windows drag-and-drop or paths with spaces)
$folderPath = $folderPath.Trim('"', "'").Trim()

if (-not (Test-Path $folderPath -PathType Container)) {
    Write-Host "Error: The specified path is not a valid folder: $folderPath" -ForegroundColor Red
    Exit
}

$folderPath = (Get-Item $folderPath).FullName
$folderName = Split-Path $folderPath -Leaf
$outputPath = Join-Path (Split-Path $folderPath -Parent) "$folderName.enc"

$password = Read-Host -Prompt "Enter a strong password to secure the folder" -AsSecureString
$confirm = Read-Host -Prompt "Confirm your password" -AsSecureString

# SecureString comparison
$bstr1 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
$bstr2 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm)
$plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr1)
$plainConfirm = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr2)

if ($plainPassword -ne $plainConfirm) {
    Write-Host "Error: Passwords do not match!" -ForegroundColor Red
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr1)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr2)
    Exit
}

[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr1)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr2)

Write-Host "Compressing folder..." -ForegroundColor Cyan
$tempZipPath = [System.IO.Path]::GetTempFileName()
Remove-Item $tempZipPath -Force -ErrorAction SilentlyContinue
[System.IO.Compression.ZipFile]::CreateFromDirectory($folderPath, $tempZipPath)

Write-Host "Encrypting folder data using AES-256 and PBKDF2 (SHA-256)..." -ForegroundColor Cyan

# Generate cryptographically secure random 16-byte salt
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$salt = New-Object byte[] 16
$rng.GetBytes($salt)

# Derive Key, IV, and HMAC Key
$hashAlg = [System.Security.Cryptography.HashAlgorithmName]::SHA256
$pbkdf2 = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($plainPassword, $salt, 100000, $hashAlg)
$keyBytes = $pbkdf2.GetBytes(32)      # 256-bit AES Key
$ivBytes = $pbkdf2.GetBytes(16)       # 128-bit AES IV
$hmacKeyBytes = $pbkdf2.GetBytes(32)  # 256-bit HMAC Key

# Read all zip bytes
$zipBytes = [System.IO.File]::ReadAllBytes($tempZipPath)

# Encrypt Zip stream
$aes = [System.Security.Cryptography.Aes]::Create()
$aes.Key = $keyBytes
$aes.IV = $ivBytes
$encryptor = $aes.CreateEncryptor()
$ciphertext = $encryptor.TransformFinalBlock($zipBytes, 0, $zipBytes.Length)

# Calculate HMAC-SHA256 over Salt + Ciphertext
$hmac = New-Object System.Security.Cryptography.HMACSHA256(,$hmacKeyBytes)
$macInput = New-Object byte[] ($salt.Length + $ciphertext.Length)
[System.Buffer]::BlockCopy($salt, 0, $macInput, 0, $salt.Length)
[System.Buffer]::BlockCopy($ciphertext, 0, $macInput, $salt.Length, $ciphertext.Length)
$mac = $hmac.ComputeHash($macInput)

# Construct Output Bytes: Salt (16) + MAC (32) + Ciphertext
$outputBytes = New-Object byte[] ($salt.Length + $mac.Length + $ciphertext.Length)
[System.Buffer]::BlockCopy($salt, 0, $outputBytes, 0, $salt.Length)
[System.Buffer]::BlockCopy($mac, 0, $outputBytes, $salt.Length, $mac.Length)
[System.Buffer]::BlockCopy($ciphertext, 0, $outputBytes, ($salt.Length + $mac.Length), $ciphertext.Length)

# Write to .enc file
[System.IO.File]::WriteAllBytes($outputPath, $outputBytes)

# Cleanup sensitive memory variables
$pbkdf2.Dispose()
$aes.Dispose()
$hmac.Dispose()
Remove-Item $tempZipPath -Force -ErrorAction SilentlyContinue

Write-Host "Folder successfully encrypted!" -ForegroundColor Green
Write-Host "Secure Encrypted Vault created at: $outputPath" -ForegroundColor Green
Write-Host ""
Write-Host "WARNING: You can now safely delete the original unencrypted folder:"
Write-Host "  Path: $folderPath" -ForegroundColor Yellow
Write-Host "Make sure you remember your password. Without it, your data cannot be recovered." -ForegroundColor Red
