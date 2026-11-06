param(
    [string]$HostAlias,
    [switch]$Uninstall,
    [switch]$ConfigOnly,
    [switch]$Yes
)
$ErrorActionPreference = 'Stop'
# No dependency on the script path: also works through irm | iex.
$base = Join-Path $env:LOCALAPPDATA 'tehablo-receptor'
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\tehablo-receptor.vbs'
if ($Uninstall) {
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -in @('powershell.exe', 'pwsh.exe', 'ffplay.exe') -and
        ($_.CommandLine -like "*`"$base\loop.ps1`"*" -or
         $_.CommandLine -like '*http://127.0.0.1:18765/audio.wav*')
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
    foreach ($file in @($startup, "$base\loop.ps1")) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
    }
    Write-Host 'Receptor retirado. Quita LocalForward 18765 127.0.0.1:8765 del Host correspondiente en ~/.ssh/config.'
    return
}
if (-not (Get-Command ffplay -ErrorAction SilentlyContinue)) {
    Write-Host 'Falta ffplay. Instala FFmpeg y vuelve a ejecutar:'
    Write-Host 'winget install Gyan.FFmpeg'
    exit 1
}
if (-not $HostAlias) { $HostAlias = Read-Host 'Alias SSH (por ejemplo mi-servidor)' }
if ($HostAlias -notmatch '^[a-zA-Z0-9_.-]+$') { throw 'Usa un alias SSH simple (letras, numeros, punto, guion).' }
$sshDir = Join-Path $env:USERPROFILE '.ssh'
$config = Join-Path $sshDir 'config'
$encoding = New-Object Text.UTF8Encoding($false)
$text = ''
if (Test-Path -LiteralPath $config) {
    # UTF8 preserves ordinary OpenSSH config, including any BOM and line endings.
    $bytes = [IO.File]::ReadAllBytes($config)
    $text = $encoding.GetString($bytes)
}
$eol = "`n"
if ($text.Contains("`r`n")) { $eol = "`r`n" }
$pattern = '(?im)^[ \t]*(?:Host|Match)[ \t]+[^\r\n]*'
$blocks = [regex]::Matches($text, $pattern)
$insertAt = -1
$seen = $false
$present = $false
# Insert only in the first block for this host; skip if any of its blocks already has the line.
for ($i = 0; $i -lt $blocks.Count; $i++) {
    $header = $blocks[$i]
    $tokens = $header.Value.Trim() -split '\s+'
    if ($tokens[0] -ieq 'Host' -and $tokens[1..($tokens.Length-1)] -ccontains $HostAlias) {
        $end = $text.Length
        if ($i + 1 -lt $blocks.Count) { $end = $blocks[$i+1].Index }
        $body = $text.Substring($header.Index, $end - $header.Index)
        # Any forward of local port 18765 (18765, localhost:18765, [::1]:18765...) counts.
        if ($body -match '(?im)^[ \t]*LocalForward[ \t]+(?:\S*:)?18765[ \t]') { $present = $true }
        if (-not $seen) { $seen = $true; $insertAt = $end }
    }
}
if ($present) {
    Write-Host "$config ya reenvia el puerto 18765 para $HostAlias; no se cambia."
} else {
    Write-Host "Archivo: $config"
    Write-Host "Host $HostAlias"
    Write-Host '    LocalForward 18765 127.0.0.1:8765'
    Write-Host 'Lleva la voz del servidor a esta computadora por tu conexion SSH; el puerto solo escucha en esta computadora (127.0.0.1).'
    Write-Host 'Se hara una copia de seguridad del archivo existente antes de cambiarlo.'
    if (-not $Yes) {
        $answer = ''
        try { $answer = Read-Host (([char]0xBF) + 'Continuar? [s/N]') } catch { }
        $Yes = $answer -match '^(s|si|s\u00ed|y|yes)$'
    }
    if (-not $Yes) {
        Write-Host "Sin cambios. Anade a mano en $config, bajo Host ${HostAlias}:"
        Write-Host '    LocalForward 18765 127.0.0.1:8765'
    }
}
if (-not $present -and $Yes) {
[void][IO.Directory]::CreateDirectory($sshDir)
if (Test-Path -LiteralPath $config) {
    Copy-Item -LiteralPath $config -Destination "$config.tehablo-$([DateTime]::Now.ToString('yyyyMMddHHmmssfffffff')).bak"
}
$forward = '    LocalForward 18765 127.0.0.1:8765'
if (-not $seen) {
    if ($text.Length -and -not $text.EndsWith("`n")) { $text += $eol }
    $text += "Host $HostAlias$eol$forward$eol"
} elseif ($insertAt -ge 0) {
    $prefix = ''
    if ($insertAt -gt 0 -and $text[$insertAt-1] -ne "`n") { $prefix = $eol }
    $text = $text.Insert($insertAt, "$prefix$forward$eol")
}
[IO.File]::WriteAllBytes($config, $encoding.GetBytes($text))
}
if ($ConfigOnly) { Write-Host 'Configuracion SSH preparada; autostart omitido (-ConfigOnly).'; return }
[void][IO.Directory]::CreateDirectory($base)
# Resolve ffplay now: login may have an older PATH.
$player = (Get-Command ffplay).Source.Replace("'", "''")
$loop = @'
$ErrorActionPreference = 'Continue'
while ($true) {
    $p = Start-Process -FilePath '__PLAYER__' -ArgumentList '-nodisp -autoexit -probesize 32 -analyzeduration 0 -loglevel quiet http://127.0.0.1:18765/audio.wav' -WindowStyle Hidden -PassThru
    if ($p) { $p.WaitForExit() }
    Start-Sleep -Seconds 3
}
'@
[IO.File]::WriteAllText("$base\loop.ps1", $loop.Replace('__PLAYER__', $player), $encoding)
$command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $base + '\loop.ps1"'
$vbs = 'CreateObject("WScript.Shell").Run "' + $command.Replace('"', '""') + '", 0, False'
[void][IO.Directory]::CreateDirectory((Split-Path $startup))
[IO.File]::WriteAllText($startup, $vbs, [Text.Encoding]::Unicode)
# Reruns replace the old loop rather than starting another listener.
Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like "*`"$base\loop.ps1`"*") -or
    ($_.Name -eq 'ffplay.exe' -and $_.CommandLine -like '*http://127.0.0.1:18765/audio.wav*')
} | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
Start-Process wscript.exe -ArgumentList ('"' + $startup + '"')
Write-Host 'Listo. Reconecta SSH; usa ssh con tu alias como siempre. Activa Audio: SSH en Pi.'
