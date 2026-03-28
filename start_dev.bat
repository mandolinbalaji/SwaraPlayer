@echo off
SETLOCAL EnableDelayedExpansion

echo Checking for Node.js installation...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed. Please install it from https://nodejs.org/
    pause
    exit /b 1
)

echo Checking for node_modules...
if not exist "node_modules\" (
    echo node_modules not found. Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo Error: npm install failed.
        pause
        exit /b 1
    )
)

echo Starting API server...
start "SwaraPlayer API" cmd /c "npm run server"

echo Starting the development server...
call npm run dev

pause
