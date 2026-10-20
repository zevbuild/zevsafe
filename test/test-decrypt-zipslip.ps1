# Test script for Zip-Slip containment check in tools/decrypt.ps1
$targetFolder = "C:\test_dest"
$targetFullPath = [System.IO.Path]::GetFullPath($targetFolder)
if (-not $targetFullPath.EndsWith([System.IO.Path]::DirectorySeparatorChar.ToString())) {
    $targetFullPath += [System.IO.Path]::DirectorySeparatorChar
}

$testEntries = @(
    '../../evil.txt',
    '..\\..\\evil.txt',
    '....//....//evil.txt',
    'C:\evil.txt',
    'C:/evil.txt',
    'D:\evil.txt',
    '\\attacker\share\evil.txt',
    '//attacker/share/evil.txt',
    '../test_dest_pwned/evil.txt',
    'valid_sub/../../evil.txt',
    '/absolute/evil.txt',
    '\absolute\evil.txt',
    'valid_dir/valid_file.txt',
    "test`0null.txt",
    'file.txt:hidden_stream.exe',
    'folder/payload.txt::$DATA',
    'CON',
    'PRN.txt',
    'AUX',
    'NUL'
)

Write-Host "Target Full Path: $targetFullPath"
Write-Host "--------------------------------------------------------------------------------"

foreach ($entryFullName in $testEntries) {
    try {
        $cleanName = $entryFullName.Replace('\', '/').TrimStart('/')

        if ([System.Text.RegularExpressions.Regex]::IsMatch($cleanName, '[\x00-\x1F\x7F]') -or ($cleanName.IndexOf(':') -ge 0)) {
            throw [System.Security.SecurityException]::new("Invalid characters or NTFS alternate data stream detected: $entryFullName")
        }

        $destPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($targetFolder, $cleanName))
        if (-not $destPath.StartsWith($targetFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw [System.Security.SecurityException]::new("Zip-Slip detected: Attempted extraction outside destination directory: $entryFullName")
        }
        $fileNameOnly = [System.IO.Path]::GetFileName($cleanName)
        if ([System.Text.RegularExpressions.Regex]::IsMatch($fileNameOnly, '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
            throw [System.Security.SecurityException]::new("Reserved Windows device name detected: $entryFullName")
        }
        foreach ($seg in $cleanName.Split('/')) {
            if ([System.Text.RegularExpressions.Regex]::IsMatch($seg, '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
                throw [System.Security.SecurityException]::new("Reserved Windows device name detected: $entryFullName")
            }
        }
        $status = "[ALLOWED]"
        Write-Host ("{0,-30} -> {1,-35} | {2}" -f $entryFullName, $destPath, $status)
    } catch {
        Write-Host ("{0,-30} -> EXCEPTION: {1} | [BLOCKED]" -f $entryFullName, $_.Exception.Message)
    }
}

Write-Host "--------------------------------------------------------------------------------"
Write-Host "Testing reserved device handle creation in .NET:"
$tempDir = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), [System.Guid]::NewGuid().ToString())
[System.IO.Directory]::CreateDirectory($tempDir) | Out-Null
try {
    foreach ($dev in @("CON", "PRN", "AUX", "NUL", "COM1", "LPT1")) {
        $p = [System.IO.Path]::Combine($tempDir, $dev)
        try {
            $fs = [System.IO.File]::Create($p)
            $fs.Dispose()
            Write-Host ("{0}: File::Create succeeded (potential device handle hijacking)" -f $dev)
        } catch {
            Write-Host ("{0}: File::Create failed: {1}" -f $dev, $_.Exception.Message)
        }
    }
} finally {
    try { [System.IO.Directory]::Delete($tempDir, $true) } catch {}
}
