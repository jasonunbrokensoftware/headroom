param(
    [Parameter(Mandatory)][string]$SourceExe,
    [Parameter(Mandatory)][string]$InstallDirectory,
    [Parameter(Mandatory)][string]$BackupDirectory
)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $SourceExe).ProviderPath
$install = (Resolve-Path -LiteralPath $InstallDirectory).ProviderPath
$target = Join-Path $install 'Headroom.exe'
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'The installed Headroom.exe does not exist.' }
if ([string]::Equals($source,$target,[StringComparison]::OrdinalIgnoreCase)) { throw 'The source must be a separate published EXE.' }
$incoming = [IO.File]::ReadAllBytes($source)
if ($incoming.Length -lt 64 -or $incoming[0] -ne 0x4d -or $incoming[1] -ne 0x5a) { throw 'The source is not a Windows executable.' }
$peOffset = [BitConverter]::ToInt32($incoming,0x3c)
if ($peOffset -lt 64 -or $peOffset -gt $incoming.Length-4 -or [BitConverter]::ToUInt32($incoming,$peOffset) -ne 0x4550) {
    throw 'The source has no valid PE header.'
}

# This is a development update helper, never an application launcher.
# Keep the installed file's NTFS identity. Renaming it into an archive lets
# Windows shortcut tracking follow the old file into an empty portable folder.
try { $stream = [IO.FileStream]::new($target,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
catch { throw "Cannot lock the installed EXE for updating. Quit Headroom from its tray menu, then retry. $($_.Exception.Message)" }
$original = [IO.MemoryStream]::new()
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $stream.CopyTo($original)
    $previous = $original.ToArray()
    $backupRoot = [IO.Path]::GetFullPath($BackupDirectory)
    [IO.Directory]::CreateDirectory($backupRoot) | Out-Null
    $backup = Join-Path $backupRoot ('Headroom-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N') + '.exe.bak')
    [IO.File]::WriteAllBytes($backup,$previous)
    $previousHash = [Convert]::ToBase64String($sha.ComputeHash($previous))
    if ([Convert]::ToBase64String($sha.ComputeHash([IO.File]::ReadAllBytes($backup))) -ne $previousHash) { throw 'Backup verification failed; the installed EXE was not changed.' }
    try {
        $stream.Position = 0
        $stream.Write($incoming,0,$incoming.Length)
        $stream.SetLength($incoming.Length)
        $stream.Flush($true)
        $stream.Position = 0
        if ([Convert]::ToBase64String($sha.ComputeHash($stream)) -ne [Convert]::ToBase64String($sha.ComputeHash($incoming))) {
            throw 'Installed EXE verification failed.'
        }
    }
    catch {
        $updateFailure = $_.Exception.Message
        try {
            $stream.Position = 0
            $stream.Write($previous,0,$previous.Length)
            $stream.SetLength($previous.Length)
            $stream.Flush($true)
        }
        catch { throw "Update and rollback failed. The original EXE is backed up at $backup. $updateFailure" }
        throw "Update failed; the original EXE was restored. $updateFailure"
    }
    Write-Output "Updated $target in place. Verified backup: $backup"
}
finally { $stream.Dispose(); $original.Dispose(); $sha.Dispose() }
