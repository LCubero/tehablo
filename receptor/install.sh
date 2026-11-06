#!/bin/sh
set -eu
# Works both from a clone and when piped into sh.
uninstall=false
config_only=false
alias_name=''
for arg in "$@"; do
    case "$arg" in
        --uninstall) uninstall=true ;;
        --config-only) config_only=true ;;
        --*) echo "Opcion desconocida: $arg" >&2; exit 1 ;;
        *) alias_name=$arg ;;
    esac
done
base="$HOME/.local/share/tehablo-receptor"
service="$HOME/.config/systemd/user/tehablo-receptor.service"
plist="$HOME/Library/LaunchAgents/com.tehablo.receptor.plist"
os=$(uname -s)
if "$uninstall"; then
    if [ "$os" = Darwin ]; then
        launchctl unload "$plist" 2>/dev/null || :
    else
        systemctl --user disable --now tehablo-receptor.service 2>/dev/null || :
    fi
    # Only remove files owned by this installer.
    for file in "$service" "$plist" "$base/loop.sh"; do
        if [ -f "$file" ]; then unlink "$file"; fi
    done
    echo 'Receptor retirado. Quita LocalForward 18765 127.0.0.1:8765 del Host correspondiente en ~/.ssh/config.'
    exit 0
fi
if ! command -v ffplay >/dev/null 2>&1; then
    echo 'Falta ffplay. Instala FFmpeg y vuelve a ejecutar:' >&2
    if [ "$os" = Darwin ]; then echo 'brew install ffmpeg' >&2
    elif command -v apt >/dev/null 2>&1; then echo 'apt install ffmpeg' >&2
    elif command -v dnf >/dev/null 2>&1; then echo 'dnf install ffmpeg-free (RPM Fusion ffmpeg tambien funciona)' >&2
    elif command -v pacman >/dev/null 2>&1; then echo 'pacman -S ffmpeg' >&2
    else echo 'Instala ffmpeg con el gestor de paquetes de tu sistema.' >&2
    fi
    exit 1
fi
if [ -z "$alias_name" ]; then
    printf 'Alias SSH (por ejemplo mi-servidor): '
    read -r alias_name </dev/tty
fi
case "$alias_name" in ''|*[!a-zA-Z0-9_.-]*) echo 'Usa un alias SSH simple (letras, numeros, punto, guion).' >&2; exit 1 ;; esac
mkdir -p "$HOME/.ssh"
config="$HOME/.ssh/config"
# Already present in any block for this host: leave the file untouched.
has_forward=false
if [ -f "$config" ] && awk -v target="$alias_name" '
{ line=$0; sub(/\r$/, "", line); n=split(line, a, /[ \t]+/); start=(a[1]=="" ? 2 : 1); key=tolower(a[start]);
  if (key=="host" || key=="match") { active=0; if (key=="host") for(i=start+1;i<=n;i++) if(a[i]==target) active=1 }
  # Any forward of local port 18765 (18765, localhost:18765, [::1]:18765...) counts.
  if (active && key=="localforward" && a[start+1] ~ /(^|:)18765$/) hit=1 }
END { exit(hit ? 0 : 1) }' "$config"; then
    has_forward=true
    printf '%s\n' "~/.ssh/config ya reenvia el puerto 18765 para $alias_name; no se cambia."
fi
if ! "$has_forward"; then
# awk preserves each original line, including CRLF; only insert new lines.
if [ -f "$config" ]; then
    cp -p "$config" "$config.tehablo-$(date +%Y%m%d%H%M%S)-$$.bak"
else
    : > "$config"
fi
last=$(tail -c 1 "$config"; printf x)
final_newline=0
[ "$last" != "
x" ] || final_newline=1
awk -v BINMODE=3 -v target="$alias_name" -v final_newline="$final_newline" '
# A CRLF file whose last line had no newline gets CRLF when a line follows it.
function emit(s) { if (wrote) printf "%s\n", (cr != "" && last !~ /\r$/ ? "\r" : ""); printf "%s", s; wrote=1; last=s; lastins=0 }
function insert() { if (active && !found) { emit("    LocalForward 18765 127.0.0.1:8765" cr); lastins=1 } }
{ original=$0; line=$0; sub(/\r$/, "", line); if (NR==1 && original ~ /\r$/) cr="\r";
  n=split(line, a, /[ \t]+/); start=(a[1]=="" ? 2 : 1); key=tolower(a[start]);
  if (key=="host" || key=="match") {
    insert(); active=0; found=0;
    # Only the first block for this host gets the line.
    if (key=="host" && !seen) for(i=start+1;i<=n;i++) if(a[i]==target) { active=1; seen=1 }
  }
  if(active && key=="localforward" && a[start+1] ~ /(^|:)18765$/) found=1;
  emit(original)
}
END { insert(); if(!seen) { emit("Host " target cr); emit("    LocalForward 18765 127.0.0.1:8765" cr) } if(final_newline || !seen || lastins) printf "\n" }
' "$config" > "$config.tehablo-new"
# Preserve file identity and permissions rather than replacing it.
cat "$config.tehablo-new" > "$config"
unlink "$config.tehablo-new"
fi
if "$config_only"; then echo 'Configuracion SSH preparada; autostart omitido (--config-only).'; exit 0; fi
mkdir -p "$base"
cat > "$base/loop.sh" <<'LOOP'
#!/bin/sh
child=''
trap '[ -z "$child" ] || kill "$child" 2>/dev/null; exit 0' TERM INT
while :; do
    ffplay -nodisp -autoexit -probesize 32 -analyzeduration 0 -loglevel quiet http://127.0.0.1:18765/audio.wav &
    child=$!
    wait "$child" || :
    child=''
    sleep 3 &
    child=$!
    wait "$child" || :
done
LOOP
if [ "$os" = Darwin ]; then
    mkdir -p "$HOME/Library/LaunchAgents"
    # XML-escape user paths.
    escaped=$(printf '%s' "$base/loop.sh" | sed 's/\&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')
    cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.tehablo.receptor</string>
<key>ProgramArguments</key><array><string>/bin/sh</string><string>$escaped</string></array>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
EOF
    launchctl unload "$plist" 2>/dev/null || :
    launchctl load "$plist"
else
    mkdir -p "$HOME/.config/systemd/user"
    cat > "$service" <<'SERVICE'
[Unit]
Description=teHablo receptor SSH
[Service]
ExecStart=/bin/sh "%h/.local/share/tehablo-receptor/loop.sh"
Restart=always
RestartSec=3
[Install]
WantedBy=default.target
SERVICE
    systemctl --user daemon-reload
    systemctl --user enable --now tehablo-receptor.service
fi
echo 'Listo. Reconecta SSH; usa ssh con tu alias como siempre. Activa Audio: SSH en Pi.'
