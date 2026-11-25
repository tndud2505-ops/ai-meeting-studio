@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4317/api/shutdown' -ContentType 'application/json' -Body '{}' -TimeoutSec 10 | Out-Null; Write-Host 'Studio stopped.' } catch { Write-Host 'Studio is not running, or is finishing an active turn.' }"
