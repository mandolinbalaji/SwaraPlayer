@echo off
echo Killing process on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000"') do (
    taskkill /PID %%a /F 2>nul
)
echo Done.
