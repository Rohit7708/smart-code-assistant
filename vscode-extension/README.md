# Personal Coding Assistant: VS Code extension

A chat panel and right-click commands in VS Code that talk to the coding-assistant
Next.js server (`../app/api/chat`), which uses a local Ollama model.

## Run it

1. Start Ollama and the server (from the `coding-assistant` folder):
   ```bash
   ollama serve          # if it isn't already running
   npm run dev           # serves http://localhost:3000
   ```
2. Open **this folder** (`vscode-extension`) in VS Code, run `npm install`, then press **F5**.
   A second "Extension Development Host" window opens with the extension loaded.
3. In that window, open any project and click the **Coding Assistant** icon in the left bar.

## Features

- **Chat panel**: asks about the folder you have open. The server searches that folder for
  relevant files and also gets the file you're editing (or your selection).
- **Right-click on selected code**: *Explain Selection*, *Fix Selection*, *Ask About This File…*
- Code blocks in answers have a **Copy** button.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `codingAssistant.serverUrl` | `http://localhost:3000` | Where the Next.js server runs |
| `codingAssistant.sendActiveFile` | `true` | Send the open file or selection with chat questions |
| `codingAssistant.requestTimeoutSeconds` | `180` | How long to wait for the model |

## Install it for everyday use

```bash
npm run compile && npm run package
code --install-extension personal-coding-assistant-0.0.1.vsix
```
