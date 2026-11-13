$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:LOCALAPPDATA 'DulceYFeliz'
$configPath = Join-Path $directory 'print-agent.json'
$launcher = Join-Path $PSScriptRoot 'start.ps1'
if ((Test-Path -LiteralPath $configPath) -or (Get-ScheduledTask -TaskName 'Dulce y Feliz - Impresion Nave' -ErrorAction SilentlyContinue)) {
  throw 'Ya existe una configuracion o tarea de impresion. Revisala antes de crear otra.'
}
$node = (Get-Command node.exe -ErrorAction Stop).Source
$urlText = Read-Host 'URL completa del endpoint de impresion (HTTPS)'
$url = $null
if (-not [Uri]::TryCreate($urlText, [UriKind]::Absolute, [ref]$url) -or $url.Scheme -ne 'https' -or $url.UserInfo) {
  throw 'Ingresa una URL HTTPS valida sin usuario ni contrasena.'
}
$printer = Read-Host 'Nombre exacto de la impresora'
if (-not $printer.Trim()) { throw 'Falta el nombre de la impresora.' }
$defaultArchive = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Dulce y Feliz\Comprobantes'
$archive = Read-Host "Carpeta para PDF de respaldo (Enter para $defaultArchive)"
if (-not $archive.Trim()) { $archive = $defaultArchive }
if (-not [IO.Path]::IsPathRooted($archive)) { throw 'La carpeta de respaldo debe ser una ruta absoluta.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'print-receipt.ps1') -PrinterName $printer -CheckOnly
if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar la impresora.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'print-receipt.ps1') -PrinterName 'Microsoft Print to PDF' -CheckOnly
if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar Microsoft Print to PDF.' }
$secureToken = Read-Host 'Token del servicio de impresion (no se mostrara)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ($token.Length -lt 32) { throw 'El token debe tener al menos 32 caracteres.' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $token = $null
}
New-Item -ItemType Directory -Path $directory -Force | Out-Null
@{
  url = $url.AbsoluteUri
  printer = $printer
  archiveDir = $archive
  token = ConvertFrom-SecureString $secureToken
  node = $node
} | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName 'Dulce y Feliz - Impresion Nave' -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName 'Dulce y Feliz - Impresion Nave'
Write-Host "Configurado. Revisa el Programador de tareas y el registro en $directory."
