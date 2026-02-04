#!/bin/bash

# Exit on any error
set -e

# Navigate to the extension directory
cd excalidraw-sync

# Install dependencies if needed
npm install

# Compile the extension
npm run compile

# Package the extension as a .vsix file (skip README check, include dependencies)
npx @vscode/vsce package --allow-star-activation

# Install the extension in VS Code
code --install-extension excalidraw-sync-*.vsix

echo "Extension installed successfully!"
