param([string]$PreviewDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\src\Headroom'))
$assets = Join-Path $project 'Assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null

# Original vector artwork. Keep the deliberately low crossbar: the open area
# above it is the visual "headroom". The 16px export is snapped to its pixel grid.
$svg = @'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <defs><linearGradient id="tile" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop stop-color="#CBD4FF"/><stop offset="1" stop-color="#8FA4F4"/></linearGradient></defs>
  <rect x="1" y="1" width="62" height="62" rx="15" fill="url(#tile)" stroke="#8C9DD8" stroke-width=".8"/>
  <g fill="#182344"><rect x="15" y="15" width="10" height="34" rx="3"/><rect x="39" y="15" width="10" height="34" rx="3"/><path d="M24 32h16v9H24z"/></g>
</svg>
'@
[IO.File]::WriteAllText((Join-Path $project 'wwwroot\headroom.svg'), $svg + "`n", [Text.UTF8Encoding]::new($false))

function RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$radius) {
    $path = [Drawing.Drawing2D.GraphicsPath]::new()
    $d = $radius * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}
$originalPalette = @{ Start='#CBD4FF'; End='#8FA4F4'; Border='#8C9DD8'; Ink='#182344' }
function RenderIcon([int]$size, [hashtable]$palette = $originalPalette) {
    $large = [Drawing.Bitmap]::new($size * 4, $size * 4, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [Drawing.Graphics]::FromImage($large)
    $g.Clear([Drawing.Color]::Transparent)
    $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.ScaleTransform([single]($size / 16.0), [single]($size / 16.0))
    $tile = RoundedPath 1 1 62 62 15
    $gradient = [Drawing.Drawing2D.LinearGradientBrush]::new([Drawing.PointF]::new(0,0), [Drawing.PointF]::new(64,64), [Drawing.ColorTranslator]::FromHtml($palette.Start), [Drawing.ColorTranslator]::FromHtml($palette.End))
    $border = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml($palette.Border), [single].8)
    $ink = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($palette.Ink))
    $g.FillPath($gradient, $tile)
    $g.DrawPath($border, $tile)
    if ($size -eq 16) {
        $g.FillRectangle($ink, 16, 16, 8, 32)
        $g.FillRectangle($ink, 40, 16, 8, 32)
        $g.FillRectangle($ink, 24, 32, 16, 8)
    } else {
        $left = RoundedPath 15 15 10 34 3
        $right = RoundedPath 39 15 10 34 3
        $g.FillPath($ink, $left); $g.FillPath($ink, $right)
        $g.FillRectangle($ink, 24, 32, 16, 9)
        $left.Dispose(); $right.Dispose()
    }
    $g.Dispose(); $tile.Dispose(); $gradient.Dispose(); $border.Dispose(); $ink.Dispose()
    $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $small = [Drawing.Graphics]::FromImage($bitmap)
    $small.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $small.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $small.DrawImage($large, [Drawing.Rectangle]::new(0,0,$size,$size), 0,0,$large.Width,$large.Height,[Drawing.GraphicsUnit]::Pixel)
    $small.Dispose(); $large.Dispose()
    return $bitmap
}

function WriteIconFiles([string]$name, [hashtable]$palette) {
$sizes = @(16,20,24,32,40,48,64,96,128,256)
$frames = @()
foreach ($size in $sizes) {
    $bitmap = RenderIcon $size $palette
    $stream = [IO.MemoryStream]::new()
    $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    $frames += ,$stream.ToArray()
    $bitmap.Dispose(); $stream.Dispose()
}
$output = [IO.File]::Create((Join-Path $assets ($name + '.ico')))
$writer = [IO.BinaryWriter]::new($output)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$frames[$i].Length); $writer.Write([uint32]$offset)
        $offset += $frames[$i].Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
} finally { $writer.Dispose(); $output.Dispose() }
$linux = RenderIcon 512 $palette
$linux.Save((Join-Path $assets ($name + '.png')), [Drawing.Imaging.ImageFormat]::Png)
$linux.Dispose()
}
WriteIconFiles 'headroom' $originalPalette

# Generate themed vectors and native exports from the actual CSS accents.
# These are build-time assets; the portable app needs no drawing library.
function MixColor([string]$hex, [int]$target, [double]$fraction) {
    $color = [Drawing.ColorTranslator]::FromHtml($hex)
    $r = [int][Math]::Round($color.R * (1-$fraction) + $target * $fraction)
    $g = [int][Math]::Round($color.G * (1-$fraction) + $target * $fraction)
    $b = [int][Math]::Round($color.B * (1-$fraction) + $target * $fraction)
    return '#{0:X2}{1:X2}{2:X2}' -f $r,$g,$b
}
$styles = [IO.File]::ReadAllText((Join-Path $project 'wwwroot\style.css'))
$themeStyles = [ordered]@{ ember = [regex]::Match($styles, ':root\s*\{([^}]+)\}').Groups[1].Value }
foreach($match in [regex]::Matches($styles, ':root\[data-theme="([a-z]+)"\]\{([^}]+)\}')) {
    $themeStyles[$match.Groups[1].Value] = $match.Groups[2].Value
}
foreach($id in $themeStyles.Keys) {
    $accent = [regex]::Match($themeStyles[$id], '--accent:\s*(#[a-fA-F0-9]{6})').Groups[1].Value
    $ink = [regex]::Match($themeStyles[$id], '--accent-ink:\s*(#[a-fA-F0-9]{6})').Groups[1].Value
    if(-not $accent -or -not $ink) { throw "Missing icon colors for $id" }
    $palette = if($id -eq 'classic') { $originalPalette } else {
        @{ Start=(MixColor $accent 255 .2); End=(MixColor $accent 0 .08); Border=(MixColor $accent 0 .18); Ink=$ink }
    }
    $themedSvg = $svg.Replace($originalPalette.Start,$palette.Start).Replace($originalPalette.End,$palette.End).Replace($originalPalette.Border,$palette.Border).Replace($originalPalette.Ink,$palette.Ink)
    [IO.File]::WriteAllText((Join-Path $project ("wwwroot\headroom-$id.svg")), $themedSvg + "`n", [Text.UTF8Encoding]::new($false))
    WriteIconFiles "headroom-$id" $palette
}

if ($PreviewDirectory) {
    New-Item -ItemType Directory -Force -Path $PreviewDirectory | Out-Null
    $preview = [Drawing.Bitmap]::new(720,280)
    $g = [Drawing.Graphics]::FromImage($preview)
    $g.Clear([Drawing.ColorTranslator]::FromHtml('#11151F'))
    $light = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#F1F3FA'))
    $g.FillRectangle($light,360,0,360,280)
    $font = [Drawing.Font]::new('Segoe UI',10,[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Pixel)
    foreach ($start in @(0,360)) {
        $largeIcon = RenderIcon 128
        $g.DrawImageUnscaled($largeIcon,$start + 116,24); $largeIcon.Dispose()
        $x = $start + 28
        foreach ($size in @(16,20,24,32,48,64)) {
            $icon = RenderIcon $size
            $g.DrawImageUnscaled($icon,$x,180 + [int]((64-$size)/2)); $icon.Dispose()
            $brush = if ($start -eq 0) { [Drawing.Brushes]::LightGray } else { [Drawing.Brushes]::DimGray }
            $g.DrawString([string]$size,$font,$brush,[single]$x,[single]253)
            $x += $size + 14
        }
    }
    $g.Dispose(); $font.Dispose(); $light.Dispose()
    $preview.Save((Join-Path $PreviewDirectory 'headroom-icon-preview.png'),[Drawing.Imaging.ImageFormat]::Png)
    $preview.Dispose()
}
Write-Output 'Built the original icon and all theme variants as SVG, 512px PNG, and 10-size Windows ICO (16–256px).'
