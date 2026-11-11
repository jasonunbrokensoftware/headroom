param([Parameter(Mandatory)][string]$WebView2Root, [Parameter(Mandatory)][string]$WilRoot)
$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Install the Visual Studio Desktop development with C++ workload.' }
$msbuild = Join-Path $vs 'MSBuild\Current\Bin\MSBuild.exe'
$vcTargets = Get-ChildItem (Join-Path $vs 'MSBuild\Microsoft\VC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$toolset = Get-ChildItem (Join-Path $vcTargets.FullName 'Platforms\x64\PlatformToolsets') -Directory | Where-Object Name -Match '^v\d+$' | Sort-Object Name -Descending | Select-Object -First 1
if (-not $toolset) { throw 'No supported x64 C++ toolset found.' }
$project = Join-Path $PSScriptRoot '..\native\Photino.Static.vcxproj'
& $msbuild $project /nologo /verbosity:minimal /m:1 /nodeReuse:false /p:Configuration=Release /p:Platform=x64 "/p:WebView2Root=$WebView2Root" "/p:WilRoot=$WilRoot" "/p:PlatformToolset=$($toolset.Name)"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
