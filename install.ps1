param([switch]$Cliente, [switch]$Receptor, [string]$HostAlias, [switch]$Uninstall, [switch]$ConfigOnly, [switch]$Yes)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if ($Cliente -or $Receptor) {
    $global:LASTEXITCODE = 0
    & "$PSScriptRoot\receptor\install.ps1" -HostAlias $HostAlias -Uninstall:$Uninstall -ConfigOnly:$ConfigOnly -Yes:$Yes
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    return
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host 'Falta uv. Instalalo con:'
    Write-Host 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
    Write-Host 'Documentacion: https://docs.astral.sh/uv/'
    exit 1
}

$envDir = '.venv-pocket'
if ((Test-Path $envDir) -and -not (Test-Path "$envDir\Scripts\python.exe" -PathType Leaf)) {
    $envDir = '.venv-pocket-windows'
}
$python = "$envDir\Scripts\python.exe"
if (-not (Test-Path $python -PathType Leaf)) {
    uv venv $envDir --python 3.12
    if ($LASTEXITCODE -ne 0) { exit 1 }
}
uv pip install --python $python -r requirements.txt `
    --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match
if ($LASTEXITCODE -ne 0) { exit 1 }

& ".\$python" -c 'import pocket_tts, ptts, sounddevice, torch; print(torch.__version__); assert torch.version.cuda is None'
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host 'Audio por SSH (en tu PC): .\install.ps1 -Cliente (-Receptor tambien funciona)'
Write-Host "Listo: $envDir"
Write-Host "Para iniciar: .\$python src/tehablo_tui.py"
Write-Host 'Los modelos se descargan en el primer uso.'
Write-Host 'Para usarlo en Pi (una vez, para todos tus proyectos):'
Write-Host "  pi install `"$PSScriptRoot\pi-extension\tehablo-tts`""
Write-Host "  (o con gentle-shell: gentle-shell install `"$PSScriptRoot\pi-extension\tehablo-tts`")"
Write-Host 'Voz opcional mas natural en Pi: Phonon 40M es (Regina, Iker; acceso restringido, uso no comercial).'
Write-Host '  Acepta los terminos en https://huggingface.co/gradium/phonon-40m-es y eligela en los ajustes de Pi (/tts menu):'
Write-Host '  pide el token solo para descargarla y no lo guarda.'
