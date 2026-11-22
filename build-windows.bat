@echo off
echo Installing dependencies...
call npm install || goto :err
echo Building Windows installer...
call npm run dist -- --win || goto :err
echo.
echo Done! Your installer is in the "dist" folder.
explorer dist
pause
exit /b
:err
echo Build failed. Make sure Node.js is installed from nodejs.org
pause
