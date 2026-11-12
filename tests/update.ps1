param([string]$SourceExe = $env:HEADROOM_TEST_EXE)
$ErrorActionPreference = 'Stop'
if (-not $SourceExe) { $SourceExe = Join-Path $PSScriptRoot '..\artifacts\single-exe\Headroom.exe' }
$source = (Resolve-Path -LiteralPath $SourceExe).ProviderPath
$testRoot = Join-Path $PSScriptRoot ('..\.test-data\update-' + [Guid]::NewGuid().ToString('N'))
$install = Join-Path $testRoot 'installation'
$backup = Join-Path $testRoot 'backups'
[IO.Directory]::CreateDirectory((Join-Path $install 'data')) | Out-Null
$target = Join-Path $install 'Headroom.exe'
$incoming = Join-Path $testRoot 'incoming.exe'
Copy-Item -LiteralPath $source -Destination $target
# Append harmless data to the disposable source so this is a real content change.
$bytes = [IO.File]::ReadAllBytes($source)
[IO.File]::WriteAllBytes($incoming,([byte[]]($bytes + [Text.Encoding]::UTF8.GetBytes('update-regression'))))
$settings = Join-Path $install 'settings.json'
$accounts = Join-Path $install 'data\accounts.json'
[IO.File]::WriteAllText($settings,'{"theme":"graphite"}')
[IO.File]::WriteAllText($accounts,'[{"id":"fixture"}]')
$settingsHash = (Get-FileHash -LiteralPath $settings).Hash
$accountsHash = (Get-FileHash -LiteralPath $accounts).Hash
$oldHash = (Get-FileHash -LiteralPath $target).Hash

# Read file identity through the same open handle; no shell/UI automation.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class UpdateFileIdentity {
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, [Out] byte[] data);
    public static string Read(string path) {
        using (var stream = File.OpenRead(path)) {
            byte[] data = new byte[52];
            if (!GetFileInformationByHandle(stream.SafeFileHandle, data)) throw new System.ComponentModel.Win32Exception();
            return BitConverter.ToString(data,28,4) + ":" + BitConverter.ToString(data,44,8);
        }
    }
}
'@
$identity = [UpdateFileIdentity]::Read($target)
$shortcutPath = [IO.Path]::GetFullPath((Join-Path $testRoot 'Headroom.lnk'))
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = [IO.Path]::GetFullPath($target)
$shortcut.WorkingDirectory = [IO.Path]::GetFullPath($install)
$shortcut.Save()
$updater = Join-Path $PSScriptRoot '..\tools\Update-Portable.ps1'

# A locked/running installation must fail before changing any bytes.
$held = [IO.File]::Open($target,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
$rejected = $false
try {
    try { & $updater -SourceExe $incoming -InstallDirectory $install -BackupDirectory $backup }
    catch { $rejected = $_.Exception.Message -like '*Quit Headroom*' }
}
finally { $held.Dispose() }
if (-not $rejected -or (Get-FileHash -LiteralPath $target).Hash -ne $oldHash) { throw 'Locked installation was changed or not rejected clearly.' }

& $updater -SourceExe $incoming -InstallDirectory $install -BackupDirectory $backup | Out-Null
if ((Get-FileHash -LiteralPath $target).Hash -ne (Get-FileHash -LiteralPath $incoming).Hash) { throw 'Updated bytes do not match.' }
if ([UpdateFileIdentity]::Read($target) -ne $identity) { throw 'Installed file identity changed.' }
$archives = @(Get-ChildItem -LiteralPath $backup -File)
if ($archives.Count -ne 1 -or $archives[0].Extension -ne '.bak' -or (Get-FileHash -LiteralPath $archives[0].FullName).Hash -ne $oldHash) { throw 'Original EXE backup is missing or incorrect.' }
if ($shell.CreateShortcut($shortcutPath).TargetPath -ne [IO.Path]::GetFullPath($target)) { throw 'Shortcut no longer targets the installation.' }
if ((Get-FileHash -LiteralPath $settings).Hash -ne $settingsHash -or (Get-FileHash -LiteralPath $accounts).Hash -ne $accountsHash) { throw 'Portable settings or account data changed.' }
Write-Output 'PASS update preserves file identity, shortcut target, account data, and settings; verifies copied backup; rejects a locked EXE.'
