<#
.SYNOPSIS
    Secure Folder Decryption Utility (High-Performance Streaming Edition)
#>

param(
    [string]$encPath
)

Add-Type -AssemblyName System.IO.Compression.FileSystem

# 1. Inputs
if ([string]::IsNullOrEmpty($encPath)) {
    $encPath = Read-Host -Prompt "Enter the absolute path of the .enc file to decrypt (or drag and drop it here)"
}

# Clean trailing slashes and quotes from drag-and-drop
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

# Compile C# Cryptor class locally (Offline compilation)
$csharpSource = @"
using System;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;

public static class FolderCryptor
{
    private const int Iterations = 100000;

    public static void DecryptFolder(string encPath, string targetFolder, string password)
    {
        using (var fileStream = new FileStream(encPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            if (fileStream.Length < 48)
            {
                throw new Exception("File is too small to be a valid encrypted archive.");
            }

            byte[] salt = new byte[16];
            byte[] fileMac = new byte[32];
            fileStream.Read(salt, 0, 16);
            fileStream.Read(fileMac, 0, 32);

            using (var pbkdf2 = new Rfc2898DeriveBytes(password, salt, Iterations, HashAlgorithmName.SHA256))
            {
                byte[] aesKey = pbkdf2.GetBytes(32);
                byte[] aesIV = pbkdf2.GetBytes(16);
                byte[] hmacKey = pbkdf2.GetBytes(32);

                using (var hmac = new HMACSHA256(hmacKey))
                {
                    hmac.TransformBlock(salt, 0, 16, null, 0);

                    byte[] buffer = new byte[8192];
                    int bytesRead;
                    while ((bytesRead = fileStream.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        hmac.TransformBlock(buffer, 0, bytesRead, null, 0);
                    }

                    hmac.TransformFinalBlock(new byte[0], 0, 0);
                    byte[] computedMac = hmac.Hash;

                    bool verified = true;
                    for (int i = 0; i < 32; i++)
                    {
                        if (fileMac[i] != computedMac[i])
                        {
                            verified = false;
                        }
                    }

                    if (!verified)
                    {
                        throw new Exception("Incorrect password or the file is corrupted.");
                    }
                }

                fileStream.Position = 48; // Skip Salt and MAC

                using (var aes = Aes.Create())
                {
                    aes.Key = aesKey;
                    aes.IV = aesIV;

                    using (var decryptor = aes.CreateDecryptor())
                    {
                        using (var cryptoStream = new CryptoStream(fileStream, decryptor, CryptoStreamMode.Read))
                        {
                            using (var archive = new ZipArchive(cryptoStream, ZipArchiveMode.Read))
                            {
                                foreach (var entry in archive.Entries)
                                {
                                    string destPath = Path.Combine(targetFolder, entry.FullName);
                                    string destDir = Path.GetDirectoryName(destPath);
                                    if (!string.IsNullOrEmpty(destDir))
                                    {
                                        Directory.CreateDirectory(destDir);
                                    }

                                    if (!entry.FullName.EndsWith("/") && !entry.FullName.EndsWith("\\"))
                                    {
                                        using (var entryStream = entry.Open())
                                        using (var outStream = new FileStream(destPath, FileMode.Create, FileAccess.Write))
                                        {
                                            entryStream.CopyTo(outStream);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
"@

try {
    Write-Host "Compiling native decryption engine..." -ForegroundColor Cyan
    Add-Type -TypeDefinition $csharpSource -ReferencedAssemblies System.IO.Compression, System.IO.Compression.FileSystem

    Write-Host "Verifying credentials and streaming decryption..." -ForegroundColor Cyan
    [FolderCryptor]::DecryptFolder($encPath, $targetFolder, $plainPassword)

    Write-Host "`nSuccess! Folder has been fully decrypted and restored." -ForegroundColor Green
    Write-Host "Restored Location: $targetFolder" -ForegroundColor Green
}
catch {
    Write-Host "`nError: Decryption failed!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.Exception.Message -like "*Access to the path*denied*") {
         Write-Host "Please ensure you have write permissions to the destination folder ($targetFolder)." -ForegroundColor Yellow
    }
}
