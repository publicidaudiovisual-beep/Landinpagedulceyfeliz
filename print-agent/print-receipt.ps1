param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [switch]$CheckOnly,
  [string]$ArchivePath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$settings = New-Object System.Drawing.Printing.PrinterSettings
$settings.PrinterName = $PrinterName
if (-not $settings.IsValid) { throw 'La impresora configurada no esta disponible.' }
$printer = Get-Printer -Name $PrinterName -ErrorAction Stop
if ($printer.PrinterStatus -ne 'Normal') { throw "La impresora indica: $($printer.PrinterStatus)." }
if ($CheckOnly) { exit 0 }

[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
$script:items = @(([Console]::In.ReadToEnd() | ConvertFrom-Json))
if ($script:items.Count -eq 0) { throw 'El comprobante esta vacio.' }
$script:itemIndex = 0
$regular = New-Object System.Drawing.Font 'Arial', $(if ($ArchivePath) { 10 } else { 8 })
$bold = New-Object System.Drawing.Font 'Arial', $(if ($ArchivePath) { 11 } else { 9 }), ([System.Drawing.FontStyle]::Bold)
$large = New-Object System.Drawing.Font 'Arial', $(if ($ArchivePath) { 14 } else { 11 }), ([System.Drawing.FontStyle]::Bold)
$small = New-Object System.Drawing.Font 'Arial', $(if ($ArchivePath) { 9 } else { 7 })
$center = New-Object System.Drawing.StringFormat
$center.Alignment = [System.Drawing.StringAlignment]::Center
$logo = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot '..\Isotipo Sin fondo.png'))
$document = New-Object System.Drawing.Printing.PrintDocument
try {
  $document.PrinterSettings.PrinterName = $PrinterName
  $document.DocumentName = 'Dulce y Feliz - comprobante'
  if ($ArchivePath) {
    $document.PrinterSettings.PrintToFile = $true
    $document.PrinterSettings.PrintFileName = $ArchivePath
    $document.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize 'A4', 827, 1169
    $document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins 45, 45, 45, 45
  } else {
    $document.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize '58mm', 228, 1100
    $document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins 10, 10, 10, 10
  }
  $document.add_PrintPage({
    param($sender, $eventArgs)
    $graphics = $eventArgs.Graphics
    $bounds = $eventArgs.MarginBounds
    $width = if ($ArchivePath) { $bounds.Width } else { [Math]::Min($bounds.Width, 205) }
    $y = [single]$bounds.Top
    while ($script:itemIndex -lt $script:items.Count) {
      $item = $script:items[$script:itemIndex]
      if ($item.type -eq 'logo') {
        $imageWidth = [single]60
        $height = [single]($imageWidth * $logo.Height / $logo.Width + 6)
      } elseif ($item.type -eq 'qr') {
        $count = $item.matrix.Count
        $dots = [Math]::Floor([Math]::Min($width - 10, 110) * [Math]::Min($graphics.DpiX, $graphics.DpiY) / 100 / ($count + 8))
        if ($dots -lt 2) { throw 'La resolucion no permite imprimir el QR de forma legible.' }
        $cell = [single]($dots * 100 / [Math]::Min($graphics.DpiX, $graphics.DpiY))
        $qrSize = [single](($count + 8) * $cell)
        $height = [single]($qrSize + 26)
      } else {
        $font = switch ($item.type) {
          'title' { $large }
          'number' { $large }
          'section' { $bold }
          'box' { $bold }
          'total' { $bold }
          'subtitle' { $small }
          default { $regular }
        }
        $height = [single]($graphics.MeasureString([string]$item.text, $font, $width).Height + 3)
        if ($item.type -eq 'section') { $height += 6 }
      }
      if ($height -gt $bounds.Height) { throw 'Un elemento del comprobante excede la pagina de impresion.' }
      if ($y + $height -gt $bounds.Bottom) {
        $eventArgs.HasMorePages = $true
        return
      }
      if ($item.type -eq 'logo') {
        $graphics.DrawImage($logo, [single]($bounds.Left + ($width - $imageWidth) / 2), $y, $imageWidth, [single]($height - 6))
      } elseif ($item.type -eq 'qr') {
        $graphics.DrawString([string]$item.label, $bold, [System.Drawing.Brushes]::Black,
          (New-Object System.Drawing.RectangleF $bounds.Left, $y, $width, 18), $center)
        $x = [single]($bounds.Left + ($width - $qrSize) / 2 + 4 * $cell)
        $qrY = [single]($y + 21 + 4 * $cell)
        for ($row = 0; $row -lt $count; $row++) {
          for ($column = 0; $column -lt $count; $column++) {
            if ($item.matrix[$row][$column]) {
              $graphics.FillRectangle([System.Drawing.Brushes]::Black,
                [single]($x + $column * $cell), [single]($qrY + $row * $cell), $cell, $cell)
            }
          }
        }
      } else {
        if ($item.type -eq 'section') {
          $graphics.DrawLine([System.Drawing.Pens]::Black, $bounds.Left, $y + 2, $bounds.Left + $width, $y + 2)
          $y += 6
          $height -= 6
        }
        $layout = New-Object System.Drawing.RectangleF $bounds.Left, $y, $width, $height
        if ($item.type -in @('title', 'subtitle', 'number')) {
          $graphics.DrawString([string]$item.text, $font, [System.Drawing.Brushes]::Black, $layout, $center)
        } else {
          $graphics.DrawString([string]$item.text, $font, [System.Drawing.Brushes]::Black, $layout)
        }
      }
      $y += $height
      $script:itemIndex++
    }
    $eventArgs.HasMorePages = $false
  })
  $document.Print()
} finally {
  $document.Dispose()
  $logo.Dispose()
  $center.Dispose()
  $regular.Dispose()
  $bold.Dispose()
  $large.Dispose()
  $small.Dispose()
}
