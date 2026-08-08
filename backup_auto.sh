#!/bin/bash
# backup_auto.sh — NOESAR Full Backup System
# Eseguito su UNRAID — invia a VPS via scp (SSH key auth)
# Uso: backup_auto.sh <component>
# Component: noesar | nova_ai | coden_ultra | coden_tui | benchmark | datafactory | coden_v6 | vps_pull | nous_brain | claude_home | brainlab
#
# SCHEDULE (cron su Unraid):
#   01:00  VPS locale     (script su VPS, non questo)
#   02:00  NOESAR
#   03:00  NOVA-AI
#   04:00  CodeN Ultra
#   05:00  Benchmark
#   06:00  DataFactory
#   07:00  CodeN V6 archivio
#   08:00  VPS pull + CodeN TUI
#   09:00  NOUS Brain (sorgente + pesi training)
#   10:00  Claude Home (.claude/ memory + settings + conversazioni)
#   10:30  BrainLab (progetto + volume docker brainlab_data con DB run)

set -euo pipefail

COMPONENT="${1:-}"
VPS_HOST="root@5.189.167.44"
VPS_BK_DIR="/root/backups"
BK_PASS_FILE="/mnt/cachec/NOESAR/SCRIPTS/.backup.secret"
LOG="/mnt/user/NOESAR_BACKUPS/backup_auto.log"
KEEP_DAYS=7
# s211: staging su disco reale, NON /tmp (che su Unraid e' RAM/rootfs 16G — un tar da 12G lo saturava
# al 100% causando OOM, orfani e Samba giu'). /mnt/cachec = NVMe con ~370G liberi. Vedi s208/s211.
TMP_DIR="/mnt/cachec/noesar_bk"

mkdir -p "$TMP_DIR" "$(dirname "$LOG")"
BK_PASS=$(cat "$BK_PASS_FILE")

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$COMPONENT] $*" | tee -a "$LOG"; }

encrypt_and_send() {
    local src_tar="$1"
    local remote_subdir="$2"
    local label="$3"
    local BK_DATE
    BK_DATE=$(date +%Y%m%dT%H%M%SZ)
    local enc_file="${TMP_DIR}/${label}_${BK_DATE}.tar.gz.enc"

    log "Cifratura → $enc_file"
    openssl enc -aes-256-cbc -pbkdf2 -iter 100000 \
        -pass pass:"$BK_PASS" \
        -in "$src_tar" -out "$enc_file"

    local SIZE SHA
    SIZE=$(du -sh "$enc_file" | cut -f1)
    SHA=$(sha256sum "$enc_file" | cut -c1-16)
    log "Cifrato: $SIZE — sha256:${SHA}..."

    log "Upload VPS: ${VPS_HOST}:${VPS_BK_DIR}/${remote_subdir}/"
    scp -q "$enc_file" "${VPS_HOST}:${VPS_BK_DIR}/${remote_subdir}/"
    log "Upload OK"

    # Rotazione remota (mantieni KEEP_DAYS)
    ssh "$VPS_HOST" "find '${VPS_BK_DIR}/${remote_subdir}' -name '*.enc' -mtime +${KEEP_DAYS} -delete; \
        COUNT=\$(ls '${VPS_BK_DIR}/${remote_subdir}'/*.enc 2>/dev/null | wc -l); \
        echo \"Archivi remoti: \$COUNT\""

    rm -f "$enc_file" "$src_tar"
    log "Pulizia locale OK"
}

case "$COMPONENT" in

# ── 02:00 ── NOESAR completo (sorgente Go, WebUI, CLAUDE.md, state, docs, postgres)
noesar)
    log "=== BACKUP NOESAR ==="
    TAR="${TMP_DIR}/noesar.tar.gz"
    tar czf "$TAR" \
        --exclude='/mnt/cachec/NOESAR/state/NOESAR_CONTEXT_PACK_CURRENT.zip' \
        --exclude='/mnt/cachec/NOESAR/model_lab/runs/*.pt' \
        --exclude='/mnt/cachec/NOESAR/.tools/claude_home/.cache/puppeteer' \
        --exclude='/mnt/cachec/NOESAR/.tools/claude_home/npm-cache' \
        --exclude='/mnt/cachec/NOESAR/.tools/claude_home/npm-global' \
        --exclude='/mnt/cachec/NOESAR/data/qdrant' \
        --exclude='/mnt/cachec/NOESAR/.tools/claude_tmp' \
        /mnt/cachec/NOESAR \
        2>/dev/null || true
    encrypt_and_send "$TAR" "noesar" "noesar"
    log "=== FINE NOESAR ==="
    ;;

# ── 03:00 ── NOVA-AI (project + state, escludi claude/ conversations se >200MB)
nova_ai)
    log "=== BACKUP NOVA-AI ==="
    TAR="${TMP_DIR}/nova_ai.tar.gz"
    tar czf "$TAR" \
        --exclude='/mnt/cachec/NOVA/claude' \
        --exclude='/mnt/cachec/NOVA/tmp' \
        --exclude='/mnt/cachec/NOVA/downloads' \
        /mnt/cachec/NOVA \
        2>/dev/null || true
    encrypt_and_send "$TAR" "nova_ai" "nova_ai"
    log "=== FINE NOVA-AI ==="
    ;;

# ── 04:00 ── CodeN Ultra (src + WEBUI + DATA senza GGUF, senza target)
coden_ultra)
    log "=== BACKUP CODEN ULTRA ==="
    TAR="${TMP_DIR}/coden_ultra.tar.gz"
    ULTRA_ROOT="/mnt/cachec/CODEN_ULTRA/CODEN_ULTRA_FULL_PRODUCT_20260606"
    tar czf "$TAR" \
        --exclude="${ULTRA_ROOT}/DATA/model_store/downloads" \
        --exclude="${ULTRA_ROOT}/target" \
        --exclude="/mnt/cachec/CODEN_ULTRA/nmod-signer/target" \
        --exclude="/mnt/cachec/CODEN_ULTRA/backups" \
        /mnt/cachec/CODEN_ULTRA \
        2>/dev/null || true
    encrypt_and_send "$TAR" "coden_ultra" "coden_ultra"
    log "=== FINE CODEN ULTRA ==="
    ;;

# ── 05:00 ── Benchmark Lab (app + DB + runs)
benchmark)
    log "=== BACKUP BENCHMARK ==="
    TAR="${TMP_DIR}/benchmark.tar.gz"
    tar czf "$TAR" \
        /mnt/cachec/CODEN_BENCHMARK \
        2>/dev/null || true
    encrypt_and_send "$TAR" "benchmark" "benchmark"
    log "=== FINE BENCHMARK ==="
    ;;

# ── 06:00 ── DataFactory (source Python + config + job files)
datafactory)
    log "=== BACKUP DATAFACTORY ==="
    TAR="${TMP_DIR}/datafactory.tar.gz"
    tar czf "$TAR" \
        /mnt/cachec/NOESAR/data/fridayn_factory \
        2>/dev/null || true
    encrypt_and_send "$TAR" "datafactory" "datafactory"
    log "=== FINE DATAFACTORY ==="
    ;;

# ── 07:00 ── CodeN V6 archivio + CodeN TUI
coden_v6)
    log "=== BACKUP CODEN V6 + TUI ==="
    TAR="${TMP_DIR}/coden_v6.tar.gz"
    tar czf "$TAR" \
        /mnt/user/CODEN \
        /mnt/cachec/CODEN_ULTRA/CODEN_ULTRA_FULL_PRODUCT_20260606/BIN/coden-tui.js \
        /mnt/cachec/CODEN_ULTRA/CODEN_ULTRA_FULL_PRODUCT_20260606/WEBUI/coden-tui.js \
        2>/dev/null || true
    encrypt_and_send "$TAR" "coden_v6" "coden_v6_tui"
    log "=== FINE CODEN V6 + TUI ==="
    ;;

# ── 08:00 ── VPS pull locale (porta il backup VPS già fatto su VPS → Unraid locale)
vps_pull)
    log "=== PULL BACKUP VPS → locale ==="
    LATEST=$(ssh "$VPS_HOST" "ls -t ${VPS_BK_DIR}/vps/*.enc 2>/dev/null | head -1")
    if [ -n "$LATEST" ]; then
        LOCAL_DIR="/mnt/user/NOESAR_BACKUPS/vps"
        mkdir -p "$LOCAL_DIR"
        scp -q "${VPS_HOST}:${LATEST}" "$LOCAL_DIR/"
        log "Copiato: $LATEST → $LOCAL_DIR"
    else
        log "Nessun backup VPS trovato"
    fi
    log "=== FINE VPS PULL ==="
    ;;

# ── 09:00 ── NOUS Brain SOLO CODICE (s132: niente dati — checkpoint esclusi
#             per non intasare il VPS; i pesi rotano keep-3 in locale.
#             A fine FASE C aggiungere il modello esportato da export.py)
nous_brain)
    log "=== BACKUP NOUS BRAIN (code only) ==="
    TAR="${TMP_DIR}/nous_brain.tar.gz"
    tar czf "$TAR" \
        --exclude='/mnt/cachec/NOESAR_BRAIN/checkpoints' \
        --exclude='/mnt/cachec/NOESAR_BRAIN/**/__pycache__' \
        --exclude='/mnt/cachec/NOESAR_BRAIN/**/*.pyc' \
        --exclude='/mnt/cachec/NOESAR_BRAIN/sandbox' \
        --exclude='/mnt/cachec/NOESAR_BRAIN/screenshots' \
        --exclude='/mnt/cachec/Coden_Nous/backups' \
        --exclude='/mnt/cachec/Coden_Nous/data' \
        /mnt/cachec/NOESAR_BRAIN \
        /mnt/cachec/CODEN_NOUS \
        /mnt/cachec/Coden_Nous \
        2>/dev/null || true
    encrypt_and_send "$TAR" "nous_brain" "nous_brain"
    log "=== FINE NOUS BRAIN ==="
    ;;

# ── domenica 11:00 ── NOUS Model (SOLO ultimo checkpoint, ~1.1GB, keep 2)
#    Unica copia offsite dei pesi: perderli = riperdere settimane di training.
nous_model)
    log "=== BACKUP NOUS MODEL (latest checkpoint) ==="
    LATEST_CKPT=$(ls -t /mnt/cachec/NOESAR_BRAIN/checkpoints/v3_phase0/nous_v3_step_*.pt 2>/dev/null | head -1)
    if [ -z "$LATEST_CKPT" ]; then
        log "Nessun checkpoint trovato — skip"
    else
        log "Checkpoint: $LATEST_CKPT"
        TAR="${TMP_DIR}/nous_model.tar.gz"
        tar czf "$TAR" "$LATEST_CKPT" 2>/dev/null || true
        KEEP_DAYS=14
        encrypt_and_send "$TAR" "nous_model" "nous_model"
    fi
    log "=== FINE NOUS MODEL ==="
    ;;

# ── 10:00 ── Claude Home (.claude/ — memory, settings, conversazioni, skills)
claude_home)
    log "=== BACKUP CLAUDE HOME ==="
    TAR="${TMP_DIR}/claude_home.tar.gz"
    tar czf "$TAR" \
        /mnt/cachec/NOESAR/.tools/claude_home/.claude \
        2>/dev/null || true
    encrypt_and_send "$TAR" "claude_home" "claude_home"
    log "=== FINE CLAUDE HOME ==="
    ;;

# ── 10:30 ── BrainLab (progetto closed-source + volume docker brainlab_data:
#             DB run/eventi SQLite. Il tar del volume è crash-consistent —
#             se il container sta scrivendo nello stesso istante, l'ultimo
#             evento può mancare; accettabile per un laboratorio di analisi)
brainlab)
    log "=== BACKUP BRAINLAB ==="
    TAR="${TMP_DIR}/brainlab.tar.gz"
    BL_VOL=$(docker volume inspect brainlab_data --format '{{.Mountpoint}}' 2>/dev/null || echo "/var/lib/docker/volumes/brainlab_data/_data")
    tar czf "$TAR" \
        /mnt/cachec/CODEN_ULTRA_BRAINLAB \
        "$BL_VOL" \
        2>/dev/null || true
    encrypt_and_send "$TAR" "brainlab" "brainlab"
    log "=== FINE BRAINLAB ==="
    ;;

noesar_evolution)
    log "=== BACKUP NOESAR EVOLUTION ==="
    # Il prodotto, e lo stato vivo che lo fa funzionare. Fino a s334 NON era in alcun backup:
    # ne il repo ne il runtime comparivano fra le sorgenti, e vivono su un solo NVMe senza parita.
    TAR="${TMP_DIR}/noesar_evolution.tar.gz"
    PG_DUMP="${TMP_DIR}/noesar_evolution_pg.dump"
    rm -f "$PG_DUMP"

    # --- Il database, preso DAL SERVER VIVO e mai copiando i suoi file ---------------------
    # Copiare /postgresql/data mentre il server gira produce una copia strappata a meta di un
    # checkpoint: e esattamente il guasto visto in s334 (PANIC: could not locate a valid
    # checkpoint record), che ha tenuto il prodotto giu mentre il container si dichiarava sano.
    # pg_dump attraversa il server e da un'istantanea coerente per costruzione.
    PGSECRET=/mnt/cachec/NOESAR_EVOLUTION_RUNTIME/config/postgres/admin.secret
    if [ -r "$PGSECRET" ] && docker ps --format '{{.Names}}' | grep -qx noesar-evolution; then
        if PGPASSWORD=$(cat "$PGSECRET") docker exec -e PGPASSWORD -u 10001 noesar-evolution \
             /usr/lib/postgresql/18/bin/pg_dump -h /workspace/postgresql/run -U noesar_admin \
             -d noesar -Fc > "$PG_DUMP" 2>/dev/null && [ -s "$PG_DUMP" ]; then
            # Un dump che non si rilegge non e un backup. Verificato PRIMA di spedirlo.
            OBJ=$(docker run --rm -v "$PG_DUMP":/d.dump:ro \
                  --entrypoint /usr/lib/postgresql/18/bin/pg_restore \
                  noesar-evolution:d0353-owner-list-s333 -l /d.dump 2>/dev/null | grep -cE '^[0-9]' || echo 0)
            if [ "$OBJ" -gt 0 ]; then
                log "pg_dump OK — $(du -h "$PG_DUMP" | cut -f1), ${OBJ} oggetti ripristinabili (verificato)"
            else
                log "ATTENZIONE: pg_dump prodotto ma NON rileggibile — spedito comunque, da investigare"
            fi
        else
            log "ATTENZIONE: pg_dump FALLITO — l'archivio parte SENZA il database"
            rm -f "$PG_DUMP"
        fi
    else
        log "ATTENZIONE: container fermo o credenziale illeggibile — archivio SENZA il database"
    fi

    # --- Tutto il resto -------------------------------------------------------------------
    # postgresql/ e escluso di proposito: il dump qui sopra lo sostituisce, e includerlo
    # aggiungerebbe 74 MB di file incoerenti che darebbero l'illusione di poter ripristinare.
    tar czf "$TAR" \
        --exclude='/mnt/cachec/NOESAR_EVOLUTION/node_modules' \
        --exclude='/mnt/cachec/NOESAR_EVOLUTION/rust/target' \
        --exclude='/mnt/cachec/NOESAR_EVOLUTION/BACKUPS' \
        --exclude='/mnt/cachec/NOESAR_EVOLUTION_RUNTIME/postgresql' \
        --exclude='/mnt/cachec/NOESAR_EVOLUTION_RUNTIME/models/artefacts' \
        /mnt/cachec/NOESAR_EVOLUTION \
        /mnt/cachec/NOESAR_EVOLUTION_RUNTIME \
        /mnt/cachec/NOESAR_EVOLUTION_SHADOWS \
        ${PG_DUMP:+"$PG_DUMP"} \
        2>/dev/null || true
    rm -f "$PG_DUMP"
    encrypt_and_send "$TAR" "noesar_evolution" "noesar_evolution"
    log "=== FINE NOESAR EVOLUTION ==="
    ;;

atom)
    log "=== BACKUP ATOM ==="
    # I pesi dei modelli sono ESCLUSI perche si riscaricano: 34 GB dei 39 totali sono
    # .gguf e .safetensors pubblici. Spedirli ogni notte riempirebbe il VPS (78 GB liberi)
    # con roba che si recupera da sola. I checkpoint SI: sono addestramento dell'Owner e
    # non esistono altrove.
    TAR="${TMP_DIR}/atom.tar.gz"
    tar czf "$TAR" \
        --exclude='/mnt/cachec/ATOM_EVOLUTION/model_store' \
        --exclude='/mnt/cachec/ATOM_EVOLUTION/target' \
        --exclude='/mnt/cachec/ATOM_EVOLUTION/vendor' \
        --exclude='/mnt/cachec/ATOM_MODEL/base' \
        /mnt/cachec/ATOM \
        /mnt/cachec/ATOM_INTERNAL \
        /mnt/cachec/ATOM_EVOLUTION \
        /mnt/cachec/ATOM_MODEL \
        2>/dev/null || true
    encrypt_and_send "$TAR" "atom" "atom"
    log "=== FINE ATOM ==="
    ;;

*)
    echo "Uso: $0 <noesar|noesar_evolution|atom|nova_ai|coden_ultra|benchmark|datafactory|coden_v6|vps_pull|nous_brain|nous_model|claude_home|brainlab>"
    exit 1
    ;;
esac
