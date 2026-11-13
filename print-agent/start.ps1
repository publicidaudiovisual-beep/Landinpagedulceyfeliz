$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:LOCALAPPDATA 'DulceYFeliz'
$config = Get-Content -LiteralPath (Join-Path $directory 'print-agent.json') -Raw | ConvertFrom-Json
$secureToken = ConvertTo-SecureString $config.token
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $env:PRINT_AGENT_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $env:PRINT_AGENT_URL = $config.url
  $env:PRINT_AGENT_PRINTER = $config.printer
  $env:PRINT_AGENT_ARCHIVE_DIR = $config.archiveDir
  & $config.node (Join-Path $PSScriptRoot 'agent.js') *>> (Join-Path $directory 'print-agent.log')
  exit $LASTEXITCODE
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  Remove-Item Env:\PRINT_AGENT_TOKEN -ErrorAction SilentlyContinue
}
