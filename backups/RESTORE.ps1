# DUNGEON KNIGHTS - RESTORE BACKUP
# Restores files to before video maps update

Write-Host "================================================" -ForegroundColor Cyan
Write-Host " DUNGEON KNIGHTS - RESTORE BACKUP" -ForegroundColor Yellow
Write-Host " Restores files to before video maps update" -ForegroundColor Yellow
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$BackupDir = Join-Path $PSScriptRoot "before-video-maps"
$ProjectDir = Split-Path $PSScriptRoot -Parent

Write-Host "Restoring files..." -ForegroundColor Green
Write-Host ""

Copy-Item "$BackupDir\index.html.backup" "$ProjectDir\index.html" -Force
Write-Host "✅ index.html restored"

Copy-Item "$BackupDir\game.js.backup" "$ProjectDir\game.js" -Force
Write-Host "✅ game.js restored"

Copy-Item "$BackupDir\dungeon.js.backup" "$ProjectDir\dungeon.js" -Force
Write-Host "✅ dungeon.js restored"

Copy-Item "$BackupDir\medieval-game.css.backup" "$ProjectDir\medieval-game.css" -Force
Write-Host "✅ medieval-game.css restored"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " ✅ RESTORE COMPLETE!" -ForegroundColor Green
Write-Host " Files have been restored to previous version." -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

Read-Host "Press Enter to exit"
