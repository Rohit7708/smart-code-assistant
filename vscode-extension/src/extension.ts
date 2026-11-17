import * as vscode from "vscode";

type ChatMessage = { role: "user" | "assistant"; content: string };

type ActiveFile = {
  path: string;
  language: string;
  content?: string;
  selection?: string;
};

// Messages the webview sends to the extension.
type FromWebview =
  | { type: "ask"; text: string }
  | { type: "clear" }
  | { type: "ready" };

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),

    vscode.commands.registerCommand("codingAssistant.explainSelection", () =>
      provider.askFromEditor("Explain what this code does, step by step."),
    ),

    vscode.commands.registerCommand("codingAssistant.fixSelection", () =>
      provider.askFromEditor(
        "Find bugs or problems in this code and give a corrected version with a short explanation.",
      ),
    ),

    vscode.commands.registerCommand("codingAssistant.askAboutFile", async () => {
      const question = await vscode.window.showInputBox({
        prompt: "Ask the coding assistant about the current file",
        placeHolder: "e.g. How can I make this faster?",
      });
      if (question) {
        await provider.askFromEditor(question);
      }
    }),

    vscode.commands.registerCommand("codingAssistant.clearChat", () => provider.clear()),
  );
}

export function deactivate() {}

class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "codingAssistant.chat";

  private view?: vscode.WebviewView;
  private history: ChatMessage[] = [];
  private busy = false;
  // A question asked from the editor before the panel finished loading.
  private pending?: { text: string; activeFile?: ActiveFile };

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = renderHtml(view.webview);

    view.webview.onDidReceiveMessage(async (msg: FromWebview) => {
      if (msg.type === "ready") {
        this.post({ type: "history", messages: this.history });
        if (this.pending) {
          const { text, activeFile } = this.pending;
          this.pending = undefined;
          await this.ask(text, activeFile);
        }
      } else if (msg.type === "ask") {
        await this.ask(msg.text, getActiveFile(false));
      } else if (msg.type === "clear") {
        this.clear();
      }
    });
  }

  clear() {
    this.history = [];
    this.post({ type: "history", messages: [] });
  }

  /** Used by the right-click commands: sends the selection (or whole file). */
  async askFromEditor(question: string) {
    const activeFile = getActiveFile(true);
    if (!activeFile) {
      vscode.window.showWarningMessage("Open a file in the editor first.");
      return;
    }
    // Reveal the chat panel; the question is sent once it is ready.
    await vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`);
    if (this.view) {
      await this.ask(question, activeFile);
    } else {
      this.pending = { text: question, activeFile };
    }
  }

  private async ask(text: string, activeFile?: ActiveFile) {
    if (this.busy) {
      vscode.window.showInformationMessage("The assistant is still answering the last question.");
      return;
    }
    const label = activeFile?.selection
      ? `${text}\n\n(selection from ${activeFile.path})`
      : text;
    this.history.push({ role: "user", content: text });
    this.post({ type: "user", content: label });
    this.post({ type: "thinking", value: true });
    this.busy = true;

    try {
      const reply = await callServer(this.history, activeFile);
      this.history.push({ role: "assistant", content: reply });
      this.post({ type: "assistant", content: reply });
    } catch (err) {
      // Drop the unanswered question so the next request isn't confused by it.
      this.history.pop();
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", content: message });
    } finally {
      this.busy = false;
      this.post({ type: "thinking", value: false });
    }
  }

  private post(message: unknown) {
    this.view?.webview.postMessage(message);
  }
}

function getActiveFile(forceSelection: boolean): ActiveFile | undefined {
  const config = vscode.workspace.getConfiguration("codingAssistant");
  if (!forceSelection && !config.get<boolean>("sendActiveFile", true)) {
    return undefined;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  const doc = editor.document;
  const selection = editor.selection.isEmpty ? undefined : doc.getText(editor.selection);
  return {
    path: vscode.workspace.asRelativePath(doc.uri),
    language: doc.languageId,
    selection,
    content: selection ? undefined : doc.getText(),
  };
}

async function callServer(messages: ChatMessage[], activeFile?: ActiveFile): Promise<string> {
  const config = vscode.workspace.getConfiguration("codingAssistant");
  const baseUrl = config.get<string>("serverUrl", "http://localhost:3000").replace(/\/+$/, "");
  const timeoutMs = config.get<number>("requestTimeoutSeconds", 180) * 1000;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, workspaceRoot, activeFile }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`No answer after ${timeoutMs / 1000}s. The local model may still be loading.`);
    }
    throw new Error(
      `Can't reach the assistant at ${baseUrl}. Start it with \`npm run dev\` in the coding-assistant folder (and make sure Ollama is running).`,
    );
  }

  const data = (await response.json().catch(() => ({}))) as {
    message?: { content?: string };
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || `Server returned ${response.status}.`);
  }
  return data.message?.content ?? "No response received.";
}

function renderHtml(webview: vscode.Webview): string {
  const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { padding: 0; margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
  #root { display: flex; flex-direction: column; height: 100vh; }
  #log { flex: 1; overflow-y: auto; padding: 8px 12px; }
  .msg { margin: 0 0 12px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
  .who { font-size: 11px; font-weight: 600; opacity: .7; margin-bottom: 2px; text-transform: uppercase; letter-spacing: .04em; }
  .user .body { background: var(--vscode-input-background); border-radius: 6px; padding: 6px 8px; }
  .error .body { color: var(--vscode-errorForeground); }
  .code { position: relative; margin: 6px 0; }
  pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; white-space: pre; margin: 0; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
  .copy { position: absolute; top: 4px; right: 4px; font-size: 11px; padding: 1px 6px; }
  .empty { opacity: .7; padding: 4px 0; }
  #thinking { padding: 0 12px 6px; opacity: .7; font-style: italic; display: none; }
  form { display: flex; gap: 6px; padding: 8px 12px 12px; border-top: 1px solid var(--vscode-panel-border); }
  textarea { flex: 1; resize: none; min-height: 34px; max-height: 160px; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 6px; }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
  button { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: .5; cursor: default; }
</style>
</head>
<body>
<div id="root">
  <div id="log"></div>
  <div id="thinking">Thinking…</div>
  <form id="form">
    <textarea id="input" rows="1" placeholder="Ask about your code (Enter to send, Shift+Enter for new line)"></textarea>
    <button id="send" type="submit">Send</button>
  </form>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById("log");
  const input = document.getElementById("input");
  const send = document.getElementById("send");
  const thinking = document.getElementById("thinking");

  function showEmpty() {
    log.innerHTML = '<div class="empty">Ask a question about your project, or select code and right-click → <b>Explain Selection</b>.</div>';
  }

  // Splits text on \`\`\` fences so code shows in blocks with a Copy button.
  function renderBody(text) {
    const body = document.createElement("div");
    body.className = "body";
    const parts = text.split(/\`\`\`[^\\n]*\\n?/);
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        const wrap = document.createElement("div");
        wrap.className = "code";
        const pre = document.createElement("pre");
        pre.textContent = part.replace(/\\n$/, "");
        const btn = document.createElement("button");
        btn.className = "copy";
        btn.textContent = "Copy";
        btn.onclick = () => {
          navigator.clipboard.writeText(pre.textContent);
          btn.textContent = "Copied";
          setTimeout(() => (btn.textContent = "Copy"), 1200);
        };
        wrap.append(pre, btn);
        body.append(wrap);
      } else if (part) {
        body.append(document.createTextNode(part));
      }
    });
    return body;
  }

  function add(kind, text) {
    log.querySelector(".empty")?.remove();
    const div = document.createElement("div");
    div.className = "msg " + kind;
    const who = document.createElement("div");
    who.className = "who";
    who.textContent = kind === "user" ? "You" : kind === "error" ? "Error" : "Assistant";
    div.append(who, renderBody(text));
    log.append(div);
    log.scrollTop = log.scrollHeight;
  }

  function submit() {
    const text = input.value.trim();
    if (!text || send.disabled) return;
    input.value = "";
    vscode.postMessage({ type: "ask", text });
  }

  document.getElementById("form").addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  window.addEventListener("message", ({ data }) => {
    switch (data.type) {
      case "history":
        log.innerHTML = "";
        if (!data.messages.length) showEmpty();
        data.messages.forEach((m) => add(m.role, m.content));
        break;
      case "user": add("user", data.content); break;
      case "assistant": add("assistant", data.content); break;
      case "error": add("error", data.content); break;
      case "thinking":
        thinking.style.display = data.value ? "block" : "none";
        send.disabled = data.value;
        break;
    }
  });

  showEmpty();
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
