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
Step "Comprovant Python (cal la 3.10, 3.11, 3.12 o 3.13)"
$okVersions = @("3.10", "3.11", "3.12", "3.13")

# Versió (p. ex. "3.13") d'un intèrpret, o $null. Es llegeix el text de
# "--version" (sense dependre del codi de sortida, que Windows PowerShell no
# sempre actualitza) i sense aturar el script si l'ordre escriu errors.
function Get-PyVersion([string]$exe, [string[]]$pre) {
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { return $null }
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { $out = (& $exe @pre --version 2>&1 | Out-String) } catch { $out = "" }
    $ErrorActionPreference = $old
    if ($out -match "Python (3\.\d+)") { return $Matches[1] }
    return $null
}

# Primer el llançador "py" (per versió, de la més nova a la més antiga) i després el "python" del PATH
$candidates = @()
foreach ($v in @("3.13", "3.12", "3.11", "3.10")) { $candidates += , @("py", "-$v") }
$candidates += , @("python")
$candidates += , @("python3")
$py = $null
foreach ($c in $candidates) {
    $exe = $c[0]
    $pre = [string[]]@($c | Select-Object -Skip 1)
    $ver = Get-PyVersion $exe $pre
    $label = ($c -join " ")
    if ($ver -and ($okVersions -contains $ver)) {
        Write-Host "  $label -> Python $ver (s'utilitzarà)"
        $py = $c
        break
    } elseif ($ver) {
        Write-Host "  $label -> Python $ver (versió no admesa)"
    } else {
        Write-Host "  $label -> no trobat"
    }
}
if (-not $py) {
    Write-Host "No s'ha trobat Python 3.10–3.13." -ForegroundColor Yellow
    Write-Host "Instal·la'l des de https://www.python.org/downloads/windows/ (marca 'Add python.exe to PATH') i torna a executar aquest script."
    exit 1
}
$pyExe = $py[0]
$pyPre = [string[]]@($py | Select-Object -Skip 1)

# --- Entorn virtual ----------------------------------------------------
if (-not (Test-Path ".venv")) {
    Step "Creant l'entorn .venv"
    & $pyExe @pyPre -m venv .venv
}
$venvPy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
& $venvPy -m pip install --upgrade pip | Out-Null

# --- GPU NVIDIA ------------------------------------------------------------
Step "Comprovant la GPU NVIDIA"
$hasNvidia = $false
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { $smi = (& nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>&1 | Out-String).Trim() } catch { $smi = "" }
    $ErrorActionPreference = $old
    if ($smi -match "NVIDIA|GeForce|RTX|Quadro|Tesla") { $hasNvidia = $true; Write-Host $smi }
}
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
