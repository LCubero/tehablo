[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$ConfigOnly,
    [switch]$Yes
)
$ErrorActionPreference = 'Stop'
# Keep this file ASCII: Windows PowerShell 5.1 misreads UTF-8 without BOM, and a BOM breaks irm | iex. Write accents as $([char]0x00F3).
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
    # Download to .part first so a cut connection never leaves a broken client.
    Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/LCubero/tehablo/master/cliente/tehablo_cliente.py' -OutFile "$client.part"
    Move-Item -LiteralPath "$client.part" -Destination $client -Force
}
$clientArgs = @('run', '--script', $client)
if ($Uninstall) {
    & uv @clientArgs --uninstall
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    return
}
$client = [IO.Path]::GetFullPath($client)
Write-Host 'Cliente instalado'
Write-Host ("Para iniciar: uv run --script '" + $client.Replace("'", "''") + "'")
Write-Host "1. Conexi$([char]0x00F3)n SSH $([char]0x2192) elegir servidor."
Write-Host "2. Vincular servidor $([char]0x2192) pegar el c$([char]0x00F3)digo de /tts codigo."
Write-Host "3. Deja el cliente abierto para o$([char]0x00ED)r la voz."
Write-Host 'Para salir: Salir o Esc.'
if (-not $Yes -and -not $ConfigOnly -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    Write-Host 'Presiona Enter para abrir el cliente (Ctrl+C para salir)'
    $null = Read-Host
    & uv run --script $client
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
