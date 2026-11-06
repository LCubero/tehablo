param(
    [string]$HostAlias,
    [switch]$Uninstall,
    [switch]$ConfigOnly,
    [switch]$Yes
)
$ErrorActionPreference = 'Stop'
# Works through irm | iex too. No writes before the dependency check.
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host 'Falta uv. Instalalo y vuelve a ejecutar:'
    Write-Host 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
    exit 1
}
$homeDir = $env:HOME
if (-not $homeDir) { $homeDir = $env:USERPROFILE }
$base = Join-Path $homeDir '.local\share\tehablo-cliente'
$client = Join-Path $base 'tehablo_cliente.py'
if ($PSScriptRoot) {
    $candidate = Join-Path $PSScriptRoot '..\cliente\tehablo_cliente.py'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $client = $candidate }
}
if (-not (Test-Path -LiteralPath $client -PathType Leaf)) {
    [void][IO.Directory]::CreateDirectory($base)
    Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/LCubero/tehablo/master/cliente/tehablo_cliente.py' -OutFile $client
}
$clientArgs = @('run', '--script', $client)
if ($Uninstall) { $clientArgs += '--uninstall' }
if ($ConfigOnly) { $clientArgs += '--config-only' }
if ($Yes) { $clientArgs += '--yes' }
if ($HostAlias) { $clientArgs += $HostAlias }
& uv @clientArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
