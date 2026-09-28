# Installs and starts the actual NSIS package on a disposable GitHub-hosted runner.
# Coverage: installation, executable startup, visible native window, WebView2 process.
# This does not verify provider authentication, chat, terminals, Git, browser tools,
# updates, or interactive behavior. Screenshot/UI Automation capture is diagnostic.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Installer,
    [Parameter(Mandatory = $true)]
    [string]$OutputDir,
    [ValidateRange(15, 180)]
    [int]$StartupTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
    throw 'The installer smoke test requires Windows.'
}
# NSIS writes per-user uninstall registration, even with a custom install directory.
# Do not run this smoke test against a developer's existing Aven installation.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Run this test on a disposable GitHub-hosted Windows runner.'
}

$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$outputPath = [IO.Path]::GetFullPath($OutputDir)
[IO.Directory]::CreateDirectory($outputPath) | Out-Null
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('aven-windows-smoke-' + [Guid]::NewGuid().ToString('N'))
# Deliberately include spaces to exercise NSIS custom-directory argument handling.
$installDirectory = Join-Path $testRoot 'Aven Test Install'
$appData = Join-Path $testRoot 'AppData\Roaming'
$localAppData = Join-Path $testRoot 'AppData\Local'
foreach ($directory in @($testRoot, $appData, $localAppData)) {
    [IO.Directory]::CreateDirectory($directory) | Out-Null
}
$cleanupMarker = Join-Path $testRoot '.aven-smoke-owned'
[IO.File]::WriteAllText($cleanupMarker, $testRoot)
$trackedProcesses = @{}
$appProcess = $null
$installerProcess = $null
$failure = $null
$result = [ordered]@{
    passed = $false
    startedAt = [DateTime]::UtcNow.ToString('o')
    installer = $installerPath
    installerSha256 = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
    installerExitCode = $null
    installedExecutable = $null
    mainWindow = $null
    webViewProcesses = @()
    screenshot = $null
    accessibleText = @()
    warnings = @()
    failure = $null
    coverage = 'NSIS install and native startup with a visible window and descendant WebView2 process; no authenticated or interactive feature verification.'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AvenSmokeWindow {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
}
'@

function Get-ProcessTree {
    param([int]$RootId)
    $all = @(Get-CimInstance Win32_Process)
    $ids = [Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add($RootId)
    do {
        $added = $false
        foreach ($process in $all) {
            if ($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)) {
                $added = $true
            }
        }
    } while ($added)
    $tree = @($all | Where-Object { $ids.Contains([int]$_.ProcessId) })
    foreach ($process in $tree) {
        $script:trackedProcesses[[int]$process.ProcessId] = $process.CreationDate
    }
    return $tree
}

function Start-SmokeProcess {
    param([string]$FilePath, [string]$Arguments, [switch]$IsolateData)
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $FilePath
    $info.Arguments = $Arguments
    $info.UseShellExecute = $false
    if ($IsolateData) {
        # Redirect components that honor these variables. Windows Known Folder
        # APIs may still use the runner profile, hence the hosted-runner guard.
        $info.Environment['APPDATA'] = $appData
        $info.Environment['LOCALAPPDATA'] = $localAppData
    }
    return [Diagnostics.Process]::Start($info)
}

try {
    # NSIS requires /D to be the final argument and its value must NOT be quoted,
    # even when the directory contains spaces. Pass one raw argument string.
    $installerProcess = Start-SmokeProcess -FilePath $installerPath -Arguments "/S /D=$installDirectory"
    $installDeadline = [DateTime]::UtcNow.AddSeconds(180)
    while (-not $installerProcess.HasExited) {
        Get-ProcessTree -RootId $installerProcess.Id | Out-Null
        if ([DateTime]::UtcNow -ge $installDeadline) { throw 'Installer did not finish within 180 seconds.' }
        Start-Sleep -Seconds 1
        $installerProcess.Refresh()
    }
    $result.installerExitCode = $installerProcess.ExitCode
    if ($installerProcess.ExitCode -notin @(0, 3010)) {
        throw "Installer failed with exit code $($installerProcess.ExitCode)."
    }
    $executable = Join-Path $installDirectory 'aven.exe'
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw "Installer did not create the expected executable: $executable"
    }
    $result.installedExecutable = $executable
    $appProcess = Start-SmokeProcess -FilePath $executable -Arguments '' -IsolateData
    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    $readySince = $null
    $window = [IntPtr]::Zero
    while ([DateTime]::UtcNow -lt $deadline) {
        $appProcess.Refresh()
        if ($appProcess.HasExited) {
            throw "Aven exited during startup with exit code $($appProcess.ExitCode)."
        }
        $tree = @(Get-ProcessTree -RootId $appProcess.Id)
        $webViews = @($tree | Where-Object { $_.Name -ieq 'msedgewebview2.exe' })
        $window = $appProcess.MainWindowHandle
        $bounds = [AvenSmokeWindow+RECT]::new()
        $visible = $window -ne [IntPtr]::Zero -and
            [AvenSmokeWindow]::IsWindowVisible($window) -and
            [AvenSmokeWindow]::GetWindowRect($window, [ref]$bounds) -and
            ($bounds.Right - $bounds.Left) -ge 200 -and ($bounds.Bottom - $bounds.Top) -ge 150
        if ($visible -and $webViews.Count -gt 0) {
            if ($null -eq $readySince) { $readySince = [DateTime]::UtcNow }
            # A short stability period catches immediate post-window startup crashes.
            if (([DateTime]::UtcNow - $readySince).TotalSeconds -ge 8) {
                $result.mainWindow = [ordered]@{
                    processId = $appProcess.Id
                    title = $appProcess.MainWindowTitle
                    width = $bounds.Right - $bounds.Left
                    height = $bounds.Bottom - $bounds.Top
                    stableSeconds = 8
                }
                $result.webViewProcesses = @($webViews | ForEach-Object {
                    [ordered]@{ processId = $_.ProcessId; name = $_.Name }
                })
                break
            }
        } else {
            $readySince = $null
        }
        Start-Sleep -Seconds 1
    }
    if ($null -eq $result.mainWindow) {
        throw "Aven did not show a stable visible window with a descendant WebView2 process within $StartupTimeoutSeconds seconds."
    }

    try {
        Add-Type -AssemblyName System.Drawing
        [void][AvenSmokeWindow]::SetForegroundWindow($window)
        Start-Sleep -Milliseconds 500
        $bounds = [AvenSmokeWindow+RECT]::new()
        if (-not [AvenSmokeWindow]::GetWindowRect($window, [ref]$bounds)) { throw 'Cannot read window bounds.' }
        $bitmap = [Drawing.Bitmap]::new($bounds.Right - $bounds.Left, $bounds.Bottom - $bounds.Top)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
            $screenshotPath = Join-Path $outputPath 'aven-windows-startup.png'
            $bitmap.Save($screenshotPath, [Drawing.Imaging.ImageFormat]::Png)
            $result.screenshot = $screenshotPath
        } finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    } catch {
        $result.warnings += "Screenshot unavailable: $($_.Exception.Message)"
    }
    try {
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        $element = [System.Windows.Automation.AutomationElement]::FromHandle($window)
        $elements = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        $result.accessibleText = @($elements | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -Unique -First 100)
    } catch {
        $result.warnings += "UI Automation text unavailable: $($_.Exception.Message)"
    }
    $appProcess.Refresh()
    if ($appProcess.HasExited) { throw "Aven exited while collecting startup evidence (exit $($appProcess.ExitCode))." }
    $result.passed = $true
} catch {
    $failure = $_
    $result.failure = $_.Exception.Message
} finally {
    # Capture remaining descendants, then stop only processes whose IDs AND creation
    # times match our observations. Never kill every Aven or WebView2 process by name.
    foreach ($rootProcess in @($appProcess, $installerProcess)) {
        if ($null -ne $rootProcess) {
            try {
                $rootProcess.Refresh()
                if (-not $rootProcess.HasExited) { Get-ProcessTree -RootId $rootProcess.Id | Out-Null }
            } catch { $result.warnings += "Process-tree cleanup inspection failed: $($_.Exception.Message)" }
        }
    }
    foreach ($entry in $trackedProcesses.GetEnumerator()) {
        try {
            $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.Key)"
            if ($null -ne $current -and $current.CreationDate -eq $entry.Value) {
                Stop-Process -Id $entry.Key -Force -ErrorAction SilentlyContinue
            }
        } catch { $result.warnings += "Process cleanup failed: $($_.Exception.Message)" }
    }
    try {
        $uninstaller = Join-Path $installDirectory 'uninstall.exe'
        if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
            # _?= prevents NSIS from creating an untracked temporary uninstaller.
            $uninstallProcess = Start-SmokeProcess -FilePath $uninstaller -Arguments "/S _?=$installDirectory"
            if (-not $uninstallProcess.WaitForExit(30000)) {
                $uninstallProcess.Kill()
                $result.warnings += 'Uninstaller exceeded the cleanup timeout.'
            } elseif ($uninstallProcess.ExitCode -ne 0) {
                $result.warnings += "Uninstaller returned exit code $($uninstallProcess.ExitCode)."
            }
        }
    } catch { $result.warnings += "Uninstaller cleanup failed: $($_.Exception.Message)" }
    try {
        if ((Test-Path -LiteralPath $cleanupMarker -PathType Leaf) -and
            [IO.File]::ReadAllText($cleanupMarker) -ceq $testRoot -and
            [IO.Path]::GetFileName($testRoot) -match '^aven-windows-smoke-[a-f0-9]{32}$') {
            Remove-Item -LiteralPath $testRoot -Recurse -Force
        }
    } catch { $result.warnings += "Temporary directory cleanup failed: $($_.Exception.Message)" }
    $result.finishedAt = [DateTime]::UtcNow.ToString('o')
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputPath 'windows-smoke-results.json') -Encoding utf8
}

if ($null -ne $failure) { throw $failure }
Write-Host "Windows installer smoke test passed. Evidence: $outputPath"
