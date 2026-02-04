@echo off
setlocal enabledelayedexpansion

REM Navigate to the extension directory
cd excalidraw-sync
if errorlevel 1 exit /b 1

REM Install dependencies if needed
call npm install
if errorlevel 1 exit /b 1

REM Compile the extension
call npm run compile
if errorlevel 1 exit /b 1

REM Package the extension as a .vsix file (skip README check, include dependencies)
call npx @vscode/vsce package --allow-star-activation
if errorlevel 1 exit /b 1

REM Install the extension in VS Code
for %%f in (excalidraw-sync-*.vsix) do (
    call code --install-extension "%%f"
    if errorlevel 1 exit /b 1
)

echo Extension installed successfully!
