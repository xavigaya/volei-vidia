# =====================================================================
# Volei VidIA — instal·lació de l'eina d'anàlisi vidia-vision (Windows 11)
#
# Ús (PowerShell, dins la carpeta vision del repositori):
#     powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# Crea un entorn Python propi (.venv), hi instal·la PyTorch amb suport per
# a la GPU NVIDIA i les biblioteques de l'eina. No modifica res fora de la
# carpeta. Es pot tornar a executar per actualitzar.
# =====================================================================
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# --- Python ----------------------------------------------------------
Step "Comprovant Python (cal la 3.10, 3.11 o 3.12)"
$py = $null
foreach ($v in @("3.12", "3.11", "3.10")) {
    try { & py "-$v" -c "import sys" 2>$null; if ($LASTEXITCODE -eq 0) { $py = @("py", "-$v"); break } } catch {}
}
if (-not $py) {
    Write-Host "No s'ha trobat Python 3.10–3.12." -ForegroundColor Yellow
    Write-Host "Instal·la'l des de https://www.python.org/downloads/windows/ (marca 'Add python.exe to PATH') i torna a executar aquest script."
    exit 1
}
& $py[0] $py[1] --version

# --- Entorn virtual ----------------------------------------------------
if (-not (Test-Path ".venv")) {
    Step "Creant l'entorn .venv"
    & $py[0] $py[1] -m venv .venv
}
$venvPy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
& $venvPy -m pip install --upgrade pip | Out-Null

# --- GPU NVIDIA ------------------------------------------------------------
Step "Comprovant la GPU NVIDIA"
$hasNvidia = $false
try { $smi = & nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>$null; if ($LASTEXITCODE -eq 0) { $hasNvidia = $true; Write-Host $smi } } catch {}
if (-not $hasNvidia) {
    Write-Host "No es detecta cap GPU NVIDIA (nvidia-smi). Actualitza el controlador des de https://www.nvidia.com/Download/index.aspx" -ForegroundColor Yellow
    Write-Host "S'instal·larà PyTorch per a CPU (funciona, però la detecció de jugadors serà molt més lenta)."
}

# --- PyTorch -----------------------------------------------------------------
Step "Instal·lant PyTorch"
$installed = $false
if ($hasNvidia) {
    foreach ($cu in @("cu128", "cu126")) {
        Write-Host "Provant PyTorch amb CUDA ($cu)…"
        & $venvPy -m pip install --upgrade torch torchvision --index-url "https://download.pytorch.org/whl/$cu"
        if ($LASTEXITCODE -eq 0) {
            & $venvPy -c "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)"
            if ($LASTEXITCODE -eq 0) { $installed = $true; break }
            Write-Host "PyTorch ($cu) no veu la GPU; es prova una altra versió." -ForegroundColor Yellow
        }
    }
}
if (-not $installed) {
    & $venvPy -m pip install --upgrade torch torchvision --index-url "https://download.pytorch.org/whl/cpu"
}

# --- Eina ------------------------------------------------------------------
Step "Instal·lant vidia-vision"
& $venvPy -m pip install --upgrade -e .

Step "Comprovació final"
& $venvPy -m vidia_vision check

Write-Host "`nFet. Per analitzar un partit:" -ForegroundColor Green
Write-Host "  .\vidia-vision.cmd analyze paquet.json --video partit.mp4"
