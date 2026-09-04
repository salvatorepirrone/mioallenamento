# Sincronizza i dati Garmin e pubblica automaticamente i soli file dati (data/*.json) su GitHub.
# Pensato per essere lanciato da Task Scheduler. Le modifiche di testo al piano NON vengono
# toccate da questo script: quelle restano un passo separato (garmin-sync/propose_updates.py),
# che richiede revisione manuale prima del merge.

$ErrorActionPreference = "Stop"

$repoRoot   = Split-Path -Parent $PSScriptRoot
$syncDir    = $PSScriptRoot
$logFile    = Join-Path $syncDir "last-run.log"

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Output $line
    Add-Content -Path $logFile -Value $line
}

try {
    Log "=== Avvio sync Garmin ==="

    Set-Location $syncDir
    docker compose run --rm garmin-sync
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose run e' fallito con exit code $LASTEXITCODE"
    }

    Set-Location $repoRoot
    git add data/garmin-weight.json data/garmin-activities.json

    $staged = git diff --cached --name-only
    if (-not $staged) {
        Log "Nessuna modifica ai dati Garmin, niente da pubblicare."
        exit 0
    }

    $today = Get-Date -Format "yyyy-MM-dd"
    git commit -m "Aggiorna dati Garmin (auto-sync $today)"
    git push origin main

    Log "Dati Garmin aggiornati e pubblicati su GitHub (Netlify fara' il deploy automaticamente)."
}
catch {
    Log "ERRORE: $_"
    exit 1
}
