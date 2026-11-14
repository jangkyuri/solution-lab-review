param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $appRoot
$appUrl = 'http://127.0.0.1:4317'
function Test-App {
  try {
    $health = Invoke-RestMethod -Uri ($appUrl + '/api/health') -TimeoutSec 2
    return $health.service -eq 'solution-lab'
  } catch { return $false }
}
if (-not (Test-App)) {
  if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'dist\index.html'))) { throw '먼저 앱 폴더에서 pnpm build를 실행해주세요.' }
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  if (-not $env:SOLUTION_LAB_PDFTOPPM) {
    $poppler = Get-Command pdftoppm -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($poppler) {
      $env:SOLUTION_LAB_PDFTOPPM = $poppler.Source
    } else {
      try {
        $runtime = Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' -ErrorAction Stop | Sort-Object Version -Descending | Select-Object -First 1
        if ($runtime) {
          $bundledPoppler = Join-Path $runtime.InstallLocation 'dependencies\native\poppler\Library\bin\pdftoppm.exe'
          if (Test-Path -LiteralPath $bundledPoppler -PathType Leaf) { $env:SOLUTION_LAB_PDFTOPPM = $bundledPoppler }
        }
      } catch { Write-Verbose 'Codex bundled PDF renderer path was unavailable.' }
    }
  }
  $dataPath = Join-Path $appRoot 'data'
  [IO.Directory]::CreateDirectory($dataPath) | Out-Null
  $process = Start-Process -FilePath $nodePath -ArgumentList @('--env-file=.env.local','--use-env-proxy','server/index.ts') -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dataPath 'app.stdout.log') -RedirectStandardError (Join-Path $dataPath 'app.stderr.log')
  [IO.File]::WriteAllText((Join-Path $dataPath 'app.pid'), [string]$process.Id)
  $deadline = [DateTime]::UtcNow.AddSeconds(25)
  while (-not (Test-App)) {
    if ($process.HasExited) { throw '앱을 시작하지 못했습니다. data/app.stderr.log를 확인해주세요.' }
    if ([DateTime]::UtcNow -gt $deadline) { throw '앱 시작이 지연되고 있습니다. 잠시 뒤 다시 실행해주세요.' }
    Start-Sleep -Milliseconds 300
  }
}
Write-Host ('Solution Lab: ' + $appUrl)
if (-not $NoBrowser) { Start-Process $appUrl }
