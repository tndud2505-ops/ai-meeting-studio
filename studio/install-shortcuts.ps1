$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$shell=New-Object -ComObject WScript.Shell
$appName=([string][char]0xD68C)+([string][char]0xC758)
$desktop=[Environment]::GetFolderPath('Desktop')
$startup=[Environment]::GetFolderPath('Startup')
$desktopPath=Join-Path $desktop ($appName+'.lnk')
$startupPath=Join-Path $startup 'AI-Meeting-Studio-Server.lnk'
$wscript=Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut=$shell.CreateShortcut($desktopPath)
$shortcut.TargetPath=$wscript
$shortcut.Arguments='"'+(Join-Path $projectRoot 'OPEN_MEETING.vbs')+'"'
$shortcut.WorkingDirectory=$projectRoot
$shortcut.Description='Local AI meeting notes'
$shortcut.IconLocation=(Join-Path $PSScriptRoot 'public\icons\meeting.ico')+',0'
$shortcut.Save()
$background=$shell.CreateShortcut($startupPath)
$background.TargetPath=$wscript
$background.Arguments='"'+(Join-Path $PSScriptRoot 'start-server.vbs')+'"'
$background.WorkingDirectory=$projectRoot
$background.Description='Start the local meeting server without opening a window'
$background.Save()
@{desktop=$desktopPath;startup=$startupPath;target=$shortcut.TargetPath;arguments=$shortcut.Arguments} | ConvertTo-Json -Compress
