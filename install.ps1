$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

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

& ".\$python" -c 'import pocket_tts, sounddevice, torch; print(torch.__version__); assert torch.version.cuda is None'
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Listo: $envDir"
Write-Host "Para iniciar: .\$python src/tehablo_tui.py"
Write-Host 'Pi encuentra el entorno automaticamente. Los modelos se descargan en el primer uso.'
