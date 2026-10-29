<#
FMU Controller 실행: 프론트엔드를 빌드(없거나 -Build)한 뒤 백엔드를 127.0.0.1:<Port>에서 띄운다.
  .\run.ps1                 # 기본: 병렬 auto (Ray, 불가 시 multiprocessing.Pool)
  .\run.ps1 -Build          # 프론트엔드 강제 재빌드
  .\run.ps1 -Parallel pool  # Ray 없이 실행
#>
param(
    [int]$Port = 8000,
    [ValidateSet('auto', 'ray', 'pool')][string]$Parallel = 'auto',
    [int]$Workers = 0,
    [switch]$Build
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$python = Join-Path $root 'backend\.venv\python.exe'
if (-not (Test-Path $python)) { throw "Python 환경이 없습니다: $python (README의 설치 절차를 따르세요)" }

if ($Build -or -not (Test-Path (Join-Path $root 'frontend\dist\index.html'))) {
    Push-Location (Join-Path $root 'frontend')
    try {
        if (-not (Test-Path 'node_modules')) { npm install; if ($LASTEXITCODE) { throw 'npm install 실패' } }
        npm run build; if ($LASTEXITCODE) { throw '프론트엔드 빌드 실패' }
    } finally { Pop-Location }
}

$env:FMUC_PARALLEL = $Parallel
if ($Workers -gt 0) { $env:FMUC_MAX_WORKERS = "$Workers" }
Push-Location (Join-Path $root 'backend')
try {
    Write-Host "FMU Controller: http://127.0.0.1:$Port  (병렬: $Parallel)"
    & $python -m uvicorn --factory app.main:create_app --host 127.0.0.1 --port $Port
} finally { Pop-Location }
