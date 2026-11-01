param(
    [Parameter(Position=0)]
    [string]$Command = "help",
    [string]$Profile = "full",
    [string]$Seed = "20261022",
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

function Show-Usage {
    Write-Host @"
TraceIQ - Manufacturing Traceability & Quality Management
Usage: .\run.ps1 <command> [-Profile <full|starter>] [-Seed <seed>] [-Port <port>]

Commands:
  all         Full pipeline: generate -> validate -> evaluate -> repro -> test
  generate    Build the synthetic dataset into out/ (Profile: full|starter)
  validate    Run the 21-check validation suite over out/
  evaluate    Evaluate engine decisions and detectors against ground truth
  repro       Regenerate twice with the same seed and compare checksums
  test        Run unit tests (python -m unittest discover -s tests -v)
  web         Install and build the React application into web/dist
  serve       Start TraceIQ API and UI server on http://localhost:<port>

Examples:
  .\run.ps1 all
  .\run.ps1 generate -Profile starter
  .\run.ps1 serve
  .\run.ps1 serve -Port 8080
"@
}

switch ($Command) {
    "all" {
        Write-Host ">>> Cleaning out directory..."
        if (Test-Path "out") { Remove-Item -Recurse -Force "out" }
        Write-Host ">>> Generating dataset (Profile: $Profile, Seed: $Seed)..."
        python src/generate.py --profile $Profile --seed $Seed --out out --with-seed-sql
        Write-Host ">>> Validating dataset..."
        python src/validate.py --out out
        Write-Host ">>> Evaluating engine against ground truth..."
        python src/evaluate.py --out out
        Write-Host ">>> Running reproducibility check..."
        python src/repro_check.py --profile starter --seed $Seed --out out
        Write-Host ">>> Running unit tests..."
        python -m unittest discover -s tests -v
        Write-Host ">>> All pipeline stages completed successfully!" -ForegroundColor Green
    }
    "generate" {
        Write-Host ">>> Generating dataset (Profile: $Profile, Seed: $Seed)..."
        python src/generate.py --profile $Profile --seed $Seed --out out --with-seed-sql
    }
    "validate" {
        Write-Host ">>> Running validation..."
        python src/validate.py --out out
    }
    "evaluate" {
        Write-Host ">>> Running evaluation..."
        python src/evaluate.py --out out
    }
    "repro" {
        Write-Host ">>> Running reproducibility check..."
        python src/repro_check.py --profile $Profile --seed $Seed --out out
    }
    "test" {
        Write-Host ">>> Running unit tests..."
        python -m unittest discover -s tests -v
    }
    "web" {
        Write-Host ">>> Building web application..."
        Push-Location web
        try {
            npm install --no-audit --no-fund
            npm run build
        } finally {
            Pop-Location
        }
    }
    "serve" {
        if (-not (Test-Path "web\dist\index.html")) {
            Write-Host ">>> Web build missing; building frontend first..."
            Push-Location web
            try {
                npm install --no-audit --no-fund
                npm run build
            } finally {
                Pop-Location
            }
        }
        Write-Host ">>> Starting TraceIQ server on http://localhost:$Port" -ForegroundColor Cyan
        Write-Host ">>> Press Ctrl+C to stop the server."
        python src/app.py --out out --web web\dist --port $Port
    }
    default {
        Show-Usage
    }
}
