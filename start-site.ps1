param(
  [switch]$Install,
  [switch]$UseWaitress
)

$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RootDir 'backend'
$FrontendDir = Join-Path $RootDir 'frontend'

function Write-Info {
  param([string]$Message)
  Write-Host "[start-site] $Message" -ForegroundColor Cyan
}

function Write-Warn {
  param([string]$Message)
  Write-Host "[start-site] $Message" -ForegroundColor Yellow
}

function Resolve-Python {
  $venvPython = Join-Path $BackendDir 'venv\Scripts\python.exe'
  $dotVenvPython = Join-Path $BackendDir '.venv\Scripts\python.exe'

  if (Test-Path $venvPython) {
    return $venvPython
  }

  if (Test-Path $dotVenvPython) {
    return $dotVenvPython
  }

  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCommand) {
    return $pythonCommand.Source
  }

  $python3Command = Get-Command python3 -ErrorAction SilentlyContinue
  if ($python3Command) {
    return $python3Command.Source
  }

  throw 'Python was not found. Install Python or create backend\venv first.'
}

function Resolve-Npm {
  $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npmCmd) {
    return $npmCmd.Source
  }

  $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
  if ($npmCommand) {
    return $npmCommand.Source
  }

  throw 'npm was not found. Install Node.js, then run npm install in frontend.'
}

if (-not (Test-Path $BackendDir)) {
  throw "Backend folder was not found: $BackendDir"
}

if (-not (Test-Path $FrontendDir)) {
  throw "Frontend folder was not found: $FrontendDir"
}

$Python = Resolve-Python
$Npm = Resolve-Npm

if (-not (Test-Path (Join-Path $BackendDir '.env'))) {
  Write-Warn 'backend\.env was not found. Copy backend\.env.example to backend\.env and fill API keys before real analysis.'
}

if (-not (Test-Path (Join-Path $FrontendDir '.env'))) {
  Write-Warn 'frontend\.env was not found. Copy frontend\.env.example to frontend\.env if you need a custom API URL.'
}

if ($Install) {
  Write-Info 'Installing backend dependencies...'
  Push-Location $BackendDir
  try {
    & $Python -m pip install -r requirements.txt
  } finally {
    Pop-Location
  }

  Write-Info 'Installing frontend dependencies...'
  Push-Location $FrontendDir
  try {
    & $Npm install
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
  throw 'frontend\node_modules was not found. Run .\start-site.ps1 -Install or run npm install in frontend.'
}

$backendEntry = if ($UseWaitress) { 'serve.py' } else { 'app.py' }

Write-Info "Backend:  http://127.0.0.1:5000 ($backendEntry)"
Write-Info 'Frontend: http://127.0.0.1:3000'
Write-Info 'Admin:    http://127.0.0.1:3000/adminpanel'
Write-Info 'Press Ctrl+C to stop both processes.'

$backendJob = Start-Job -Name 'ooppssie-backend' -ScriptBlock {
  param($WorkingDir, $PythonPath, $EntryPoint)
  Set-Location $WorkingDir
  & $PythonPath $EntryPoint
} -ArgumentList $BackendDir, $Python, $backendEntry

$frontendJob = Start-Job -Name 'ooppssie-frontend' -ScriptBlock {
  param($WorkingDir, $NpmPath)
  Set-Location $WorkingDir
  & $NpmPath run dev
} -ArgumentList $FrontendDir, $Npm

$jobs = @($backendJob, $frontendJob)

function Receive-LoggedJobOutput {
  param([System.Management.Automation.Job]$Job)

  $receiveErrors = @()
  $output = Receive-Job -Job $Job -ErrorAction SilentlyContinue -ErrorVariable receiveErrors

  foreach ($line in $output) {
    Write-Host "[$($Job.Name)] $line"
  }

  foreach ($receiveError in $receiveErrors) {
    Write-Host "[$($Job.Name)] $($receiveError.ToString())" -ForegroundColor Yellow
  }
}

try {
  while ($true) {
    foreach ($job in $jobs) {
      Receive-LoggedJobOutput -Job $job

      if ($job.State -in @('Failed', 'Stopped', 'Completed')) {
        Receive-LoggedJobOutput -Job $job
        throw "$($job.Name) exited with state $($job.State)."
      }
    }

    Start-Sleep -Seconds 1
  }
} finally {
  Write-Info 'Stopping site processes...'
  foreach ($job in $jobs) {
    if ($job.State -eq 'Running') {
      Stop-Job -Job $job
    }
    Remove-Job -Job $job -Force
  }
}
