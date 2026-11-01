@echo off
setlocal
cd /d "%~dp0"

set PROFILE=full
set SEED=20261022
set PORT=3000

set "CMD=%~1"
if "%CMD%"=="" goto usage

if /i "%CMD%"=="all" goto all
if /i "%CMD%"=="generate" goto generate
if /i "%CMD%"=="validate" goto validate
if /i "%CMD%"=="evaluate" goto evaluate
if /i "%CMD%"=="repro" goto repro
if /i "%CMD%"=="test" goto test
if /i "%CMD%"=="web" goto web
if /i "%CMD%"=="serve" goto serve
goto usage

:all
echo [TraceIQ] Cleaning out directory...
if exist out rmdir /s /q out
echo [TraceIQ] Generating dataset (Profile: %PROFILE%, Seed: %SEED%)...
python src\generate.py --profile %PROFILE% --seed %SEED% --out out --with-seed-sql
if errorlevel 1 exit /b 1
echo [TraceIQ] Validating dataset...
python src\validate.py --out out
if errorlevel 1 exit /b 1
echo [TraceIQ] Evaluating engine against ground truth...
python src\evaluate.py --out out
if errorlevel 1 exit /b 1
echo [TraceIQ] Running reproducibility check...
python src\repro_check.py --profile starter --seed %SEED% --out out
if errorlevel 1 exit /b 1
echo [TraceIQ] Running unit tests...
python -m unittest discover -s tests -v
if errorlevel 1 exit /b 1
echo [TraceIQ] All pipeline stages completed successfully!
goto :eof

:generate
echo [TraceIQ] Generating dataset (Profile: %PROFILE%, Seed: %SEED%)...
python src\generate.py --profile %PROFILE% --seed %SEED% --out out --with-seed-sql
goto :eof

:validate
echo [TraceIQ] Running validation...
python src\validate.py --out out
goto :eof

:evaluate
echo [TraceIQ] Running evaluation...
python src\evaluate.py --out out
goto :eof

:repro
echo [TraceIQ] Running reproducibility check...
python src\repro_check.py --profile starter --seed %SEED% --out out
goto :eof

:test
echo [TraceIQ] Running unit tests...
python -m unittest discover -s tests -v
goto :eof

:web
echo [TraceIQ] Building web application...
cd web
call npm install --no-audit --no-fund
call npm run build
cd ..
goto :eof

:serve
if not exist "web\dist\index.html" (
  echo [TraceIQ] Web build missing; building frontend first...
  cd web
  call npm install --no-audit --no-fund
  call npm run build
  cd ..
)
echo [TraceIQ] Starting server on http://localhost:%PORT%
python src\app.py --out out --web web\dist --port %PORT%
goto :eof

:usage
echo TraceIQ - Manufacturing Traceability and Quality Management
echo Usage: run.bat [command]
echo.
echo Commands:
echo   all         Full pipeline: generate, validate, evaluate, repro, test
echo   generate    Build the synthetic dataset into out/
echo   validate    Run the 21-check validation suite over out/
echo   evaluate    Evaluate engine decisions and detectors against ground truth
echo   repro       Regenerate twice and compare checksums
echo   test        Run unit tests
echo   web         Install and build the React application
echo   serve       Start TraceIQ API and UI server on http://localhost:3000
goto :eof
