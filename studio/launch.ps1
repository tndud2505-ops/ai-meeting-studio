param([switch]$NoBrowser,[switch]$AppWindow)
$ErrorActionPreference='Stop'
$studioRoot=$PSScriptRoot
$projectRoot=Split-Path -Parent $studioRoot
$url='http://127.0.0.1:4317'
$healthy=$false
try {
  $status=Invoke-RestMethod -Uri "$url/health" -TimeoutSec 2
  if($status.app -ne 'AI Meeting Studio'){throw 'Port 4317 is in use by another app.'}
  $healthy=$true
} catch {
  if($_.Exception.Message -like '*another app*'){throw}
}
if(-not $healthy){
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  $logDir=Join-Path $studioRoot 'data'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $serverFile=Join-Path $studioRoot 'server.mjs'
  Start-Process -FilePath $node -ArgumentList @('"'+$serverFile+'"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server-error.log') | Out-Null
  for($attempt=0;$attempt -lt 35;$attempt++){
    Start-Sleep -Milliseconds 200
    try{$status=Invoke-RestMethod -Uri "$url/health" -TimeoutSec 1;if($status.app -eq 'AI Meeting Studio'){$healthy=$true;break}}catch{}
  }
}
if(-not $healthy){throw 'Studio did not start. See studio/data/server-error.log.'}
if(-not $NoBrowser){
  $chromePaths=@((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),(Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),(Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'))
  $chrome=$chromePaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if($AppWindow -and $chrome){Start-Process -FilePath $chrome -ArgumentList @("--app=$url")}
  else{Start-Process $url}
}
Write-Output $url
