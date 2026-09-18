@echo off
echo ================================================
echo  DUNGEON KNIGHTS - RESTORE BACKUP
echo  Restores files to before video maps update
echo ================================================
echo.

set BACKUP_DIR=%~dp0before-video-maps
set PROJECT_DIR=%~dp0..

echo Restoring files...
echo.

copy /Y "%BACKUP_DIR%\index.html.backup" "%PROJECT_DIR%\index.html"
copy /Y "%BACKUP_DIR%\game.js.backup" "%PROJECT_DIR%\game.js"
copy /Y "%BACKUP_DIR%\dungeon.js.backup" "%PROJECT_DIR%\dungeon.js"
copy /Y "%BACKUP_DIR%\medieval-game.css.backup" "%PROJECT_DIR%\medieval-game.css"

echo.
echo ================================================
echo  ✅ RESTORE COMPLETE!
echo  Files have been restored to previous version.
echo ================================================
echo.
pause
