<#
.SYNOPSIS
    Secure Folder Encryption Utility (High-Performance Streaming Edition)
#>

param(
    [string]$folderPath
)

# 1. Inputs
if ([string]::IsNullOrEmpty($folderPath)) {
    $folderPath = Read-Host -Prompt "Enter the absolute path of the folder to encrypt (or drag and drop it here)"
}

# Clean trailing slashes and quotes from drag-and-drop
$folderPath = $folderPath.Trim('"', "'").Trim().TrimEnd('\', '/')

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

# Compile C# Cryptor class locally (Offline compilation)
$csharpSource = @"
using System;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;

public static class FolderCryptor
{
    private const int Iterations = 100000;

    private class HashingStream : Stream
    {
        private readonly Stream _baseStream;
        private readonly HMACSHA256 _hmac;

        public HashingStream(Stream baseStream, HMACSHA256 hmac)
        {
            _baseStream = baseStream;
            _hmac = hmac;
        }

        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public override void Flush() => _baseStream.Flush();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count)
        {
            _baseStream.Write(buffer, offset, count);
            _hmac.TransformBlock(buffer, offset, count, null, 0);
        }
    }

    public static void EncryptFolder(string folderPath, string outputPath, string password)
    {
        byte[] salt = new byte[16];
        using (var rng = RandomNumberGenerator.Create())
        {
            rng.GetBytes(salt);
        }

        using (var pbkdf2 = new Rfc2898DeriveBytes(password, salt, Iterations, HashAlgorithmName.SHA256))
        {
            byte[] aesKey = pbkdf2.GetBytes(32);
            byte[] aesIV = pbkdf2.GetBytes(16);
            byte[] hmacKey = pbkdf2.GetBytes(32);

            using (var fileStream = new FileStream(outputPath, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                fileStream.Write(salt, 0, 16);
                byte[] emptyMac = new byte[32];
                fileStream.Write(emptyMac, 0, 32);

                using (var hmac = new HMACSHA256(hmacKey))
                {
                    // Include the Salt in the HMAC hash first
                    hmac.TransformBlock(salt, 0, 16, null, 0);

                    using (var hashingStream = new HashingStream(fileStream, hmac))
                    {
                        using (var aes = Aes.Create())
                        {
                            aes.Key = aesKey;
                            aes.IV = aesIV;

                            using (var encryptor = aes.CreateEncryptor())
                            {
                                using (var cryptoStream = new CryptoStream(hashingStream, encryptor, CryptoStreamMode.Write))
                                {
                                    using (var archive = new ZipArchive(cryptoStream, ZipArchiveMode.Create, true))
                                    {
                                        AddDirectoryToArchive(archive, folderPath, "");
                                    }
                                }
                            }
                        }
                    }

                    hmac.TransformFinalBlock(new byte[0], 0, 0);
                    byte[] macValue = hmac.Hash;

                    fileStream.Position = 16;
                    fileStream.Write(macValue, 0, 32);
                }
            }
        }
    }

    private static void AddDirectoryToArchive(ZipArchive archive, string sourceDirPath, string entryPrefix)
    {
        var dirInfo = new DirectoryInfo(sourceDirPath);

        foreach (var file in dirInfo.GetFiles())
        {
            string entryName = Path.Combine(entryPrefix, file.Name);
            var entry = archive.CreateEntry(entryName, CompressionLevel.Optimal);
            using (var entryStream = entry.Open())
            using (var fileStream = file.OpenRead())
            {
                fileStream.CopyTo(entryStream);
            }
        }

        foreach (var subDir in dirInfo.GetDirectories())
        {
            string newPrefix = Path.Combine(entryPrefix, subDir.Name);
            AddDirectoryToArchive(archive, subDir.FullName, newPrefix);
        }
    }
}
"@

try {
    Write-Host "Compiling native encryption engine..." -ForegroundColor Cyan
    Add-Type -TypeDefinition $csharpSource -ReferencedAssemblies System.IO.Compression, System.IO.Compression.FileSystem

    Write-Host "Streaming folder encryption directly to disk..." -ForegroundColor Cyan
    [FolderCryptor]::EncryptFolder($folderPath, $outputPath, $plainPassword)

    Write-Host "`nFolder successfully encrypted!" -ForegroundColor Green
    Write-Host "Secure Encrypted Vault created at: $outputPath" -ForegroundColor Green
    Write-Host ""
    Write-Host "WARNING: You can now safely delete the original unencrypted folder:"
    Write-Host "  Path: $folderPath" -ForegroundColor Yellow
    Write-Host "Make sure you remember your password. Without it, your data cannot be recovered." -ForegroundColor Red
}
catch {
    Write-Host "`nError: Encryption failed!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.Exception.Message -like "*Access to the path*denied*") {
        Write-Host "Please ensure you have write permissions to the destination folder." -ForegroundColor Yellow
        Write-Host "If you are trying to encrypt a folder directly in the root of C:\, Windows blocks this by default." -ForegroundColor Yellow
        Write-Host "Try moving the folder into Documents or Desktop and encrypting it there." -ForegroundColor Yellow
    }
}
