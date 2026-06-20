<#
.SYNOPSIS
    System Check Utility
.DESCRIPTION
    Scans the system for OS details, hardware specs, disk drives, system files,
    developer tools, and installed applications, generating a clean Markdown report.
#>

$reportPath = Join-Path $PSScriptRoot "system_report.md"
$reportContent = @()

# Helper function to append line to report
function Add-ReportLine ($line) {
    $global:reportContent += $line
}

Add-ReportLine "# System Scan Report"
Add-ReportLine "Generated on: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Add-ReportLine ""

# 1. OS Info
Add-ReportLine "## 1. Operating System Details"
Add-ReportLine ""
$os = Get-CimInstance Win32_OperatingSystem
Add-ReportLine "- **OS Name**: $($os.Caption)"
Add-ReportLine "- **Version**: $($os.Version)"
Add-ReportLine "- **Architecture**: $($os.OSArchitecture)"
Add-ReportLine "- **System Directory**: $($os.SystemDirectory)"
Add-ReportLine "- **Windows Directory**: $($os.WindowsDirectory)"
Add-ReportLine ""

# 2. Hardware Info
Add-ReportLine "## 2. Hardware Specifications"
Add-ReportLine ""
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$totalRamGB = [Math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
$freeRamGB = [Math]::Round($os.FreePhysicalMemory / 1MB, 2)
$usedRamGB = [Math]::Round($totalRamGB - $freeRamGB, 2)

Add-ReportLine "- **CPU**: $($cpu.Name)"
Add-ReportLine "- **Physical Cores**: $($cpu.NumberOfCores)"
Add-ReportLine "- **Logical Processors**: $($cpu.NumberOfLogicalProcessors)"
Add-ReportLine "- **Total RAM**: $totalRamGB GB"
Add-ReportLine "- **Free RAM**: $freeRamGB GB"
Add-ReportLine "- **Used RAM**: $usedRamGB GB"
Add-ReportLine ""

# 3. Disk Space
Add-ReportLine "## 3. Disk Storage"
Add-ReportLine ""
Add-ReportLine "| Drive | Size (GB) | Free (GB) | Used (GB) | % Free |"
Add-ReportLine "|-------|-----------|-----------|-----------|--------|"
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
    $sizeGB = [Math]::Round($_.Size / 1GB, 2)
    $freeGB = [Math]::Round($_.FreeSpace / 1GB, 2)
    $usedGB = [Math]::Round($sizeGB - $freeGB, 2)
    $pctFree = [Math]::Round(($freeGB / $sizeGB) * 100, 2)
    Add-ReportLine "| $($_.DeviceID) | $sizeGB | $freeGB | $usedGB | $pctFree% |"
}
Add-ReportLine ""

# 4. Critical System Files Check
Add-ReportLine "## 4. Critical System Files Status"
Add-ReportLine ""
$systemFiles = @(
    @{ Name = "Hosts File"; Path = "$env:windir\System32\drivers\etc\hosts" },
    @{ Name = "Pagefile"; Path = "C:\pagefile.sys" },
    @{ Name = "Environment Path Size"; Path = "Env:\Path" }
)

Add-ReportLine "| File/Resource | Status | Path / Details |"
Add-ReportLine "|---------------|--------|----------------|"
foreach ($file in $systemFiles) {
    if ($file.Path -eq "Env:\Path") {
        $len = $env:Path.Length
        Add-ReportLine "| $($file.Name) | OK | Length: $len characters |"
    } else {
        if (Test-Path $file.Path -ErrorAction SilentlyContinue) {
            $size = (Get-Item $file.Path -Force).Length
            Add-ReportLine "| $($file.Name) | Exists | Size: $size bytes - $($file.Path) |"
        } else {
            Add-ReportLine "| $($file.Name) | Not Found | $($file.Path) |"
        }
    }
}
Add-ReportLine ""

# 5. Developer Tools and Environments
Add-ReportLine "## 5. Developer CLI Tools"
Add-ReportLine ""
Add-ReportLine "| Tool | Status | Version | Path |"
Add-ReportLine "|------|--------|---------|------|"

$tools = @("node", "npm", "git", "python", "pip", "java", "dotnet", "docker", "gcc", "g++", "rustc", "go", "code")
foreach ($tool in $tools) {
    $cmd = Get-Command $tool -ErrorAction SilentlyContinue
    if ($cmd) {
        $version = "Unknown"
        try {
            if ($tool -eq "node") { $version = (node -v).Trim() }
            elseif ($tool -eq "npm") { $version = (npm -v).Trim() }
            elseif ($tool -eq "git") { $version = (git --version).Trim() }
            elseif ($tool -eq "python") { $version = (python --version).Trim() }
            elseif ($tool -eq "pip") { $version = (pip --version).Trim() -replace 'from.*$' }
            elseif ($tool -eq "java") { $version = (java -version 2>&1 | Select-Object -First 1).Trim() }
            elseif ($tool -eq "dotnet") { $version = (dotnet --version).Trim() }
            elseif ($tool -eq "docker") { $version = (docker --version).Trim() }
            elseif ($tool -eq "gcc") { $version = (gcc --version | Select-Object -First 1).Trim() }
            elseif ($tool -eq "rustc") { $version = (rustc --version).Trim() }
            elseif ($tool -eq "go") { $version = (go version).Trim() }
            elseif ($tool -eq "code") { $version = (code --version | Select-Object -First 1).Trim() }
        } catch {
            $version = "Error reading version"
        }
        $escapedPath = $cmd.Source -replace '\\', '\\'
        Add-ReportLine "| $tool | Installed | $version | $escapedPath |"
    } else {
        Add-ReportLine "| $tool | Not Found | - | - |"
    }
}
Add-ReportLine ""

# 6. Installed Desktop Applications (via Registry)
Add-ReportLine "## 6. Installed Desktop Applications"
Add-ReportLine ""
Add-ReportLine "| Application Name | Version | Publisher |"
Add-ReportLine "|------------------|---------|-----------|"

$installedApps = @()
$regPaths = @(
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

foreach ($path in $regPaths) {
    $parent = Split-Path $path
    if (Test-Path $parent) {
        $installedApps += Get-ItemProperty $path -ErrorAction SilentlyContinue | 
            Select-Object DisplayName, DisplayVersion, Publisher | 
            Where-Object { $_.DisplayName -ne $null }
    }
}

$uniqueApps = $installedApps | Sort-Object DisplayName -Unique
foreach ($app in $uniqueApps) {
    $name = $app.DisplayName -replace '\|', '-'
    $ver = $app.DisplayVersion -replace '\|', '-'
    $pub = $app.Publisher -replace '\|', '-'
    Add-ReportLine "| $name | $ver | $pub |"
}

# Write report to file
$reportContent | Out-File -FilePath $reportPath -Encoding utf8
Write-Host "Scan completed! Report written to: $reportPath"
