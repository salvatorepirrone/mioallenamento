# Esecuzione di mezzanotte: sync Garmin + pulizia dei giorni ormai passati dal
# programma (index.html) — a quel punto l'attivita' svolta e' gia' visibile
# nella tabella live "Ultimi allenamenti registrati". Pubblica tutto insieme
# (dati + eventuali modifiche a index.html) su GitHub in un solo commit.
#
# Il sync delle 15:00 (run-sync.ps1) resta separato e NON tocca index.html:
# la pulizia dei giorni passati ha senso solo una volta al giorno.

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$syncDir  = $PSScriptRoot
$logFile  = Join-Path $syncDir "last-run.log"

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Output $line
    Add-Content -Path $logFile -Value $line
}

try {
    Log "=== Avvio sync + pulizia programma (mezzanotte) ==="

    Set-Location $syncDir

    docker compose run --rm garmin-sync
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose run (garmin) e' fallito con exit code $LASTEXITCODE"
    }

    docker compose run --rm garmin-sync python withings_sync.py
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose run (withings) e' fallito con exit code $LASTEXITCODE"
    }

    python "$syncDir\cleanup_past_days.py"
    if ($LASTEXITCODE -ne 0) {
        throw "cleanup_past_days.py e' fallito con exit code $LASTEXITCODE"
    }

    Set-Location $repoRoot
    git add data/garmin-weight.json data/garmin-activities.json data/withings-weight.json index.html

    $staged = git diff --cached --name-only
    if (-not $staged) {
        Log "Nessuna modifica da pubblicare."
        exit 0
    }

    $today = Get-Date -Format "yyyy-MM-dd"
    git commit -m "Aggiorna dati Garmin/Withings e rimuovi giorni passati dal programma (auto $today)"
    git push origin main

    Log "Pubblicato su GitHub (Netlify fara' il deploy automaticamente)."
}
catch {
    Log "ERRORE: $_"
    exit 1
}
