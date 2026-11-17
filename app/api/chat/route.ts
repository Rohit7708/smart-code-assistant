import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { buildRepositoryIndex, getRelevantRepoContext } from "@/lib/repo-context";

type ActiveFile = {
  path?: string;
  language?: string;
  content?: string;
  selection?: string;
};

// The VS Code extension sends the folder the user has open. Fall back to this
// app's own directory when the request doesn't name a valid folder.
function resolveRepoRoot(workspaceRoot: unknown) {
  if (
    typeof workspaceRoot === "string" &&
    path.isAbsolute(workspaceRoot) &&
    fs.existsSync(workspaceRoot) &&
    fs.statSync(workspaceRoot).isDirectory()
  ) {
    return { repoRoot: workspaceRoot, fromEditor: true };
  }
  return { repoRoot: process.cwd(), fromEditor: false };
}

function buildEditorPrompt(activeFile: ActiveFile | undefined) {
  if (!activeFile?.path) {
    return "";
  }
  const language = activeFile.language || "";
  const parts = [`The user is currently editing: ${activeFile.path}`];
  if (activeFile.selection) {
    parts.push(`Selected code:\n\`\`\`${language}\n${activeFile.selection.slice(0, 8000)}\n\`\`\``);
  } else if (activeFile.content) {
    parts.push(`File contents:\n\`\`\`${language}\n${activeFile.content.slice(0, 8000)}\n\`\`\``);
  }
  return parts.join("\n\n");
}

export async function POST(request: NextRequest) {
  try {
    const { messages, workspaceRoot, activeFile } = await request.json();

    const ollamaHost = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
    const model = process.env.OLLAMA_MODEL || "llama3.2";

    const lastUserMessage = [...messages]
      .reverse()
      .find((message: { role: string; content: string }) => message.role === "user")?.content || "";

    const { repoRoot, fromEditor } = resolveRepoRoot(workspaceRoot);
    const toolCalls = [] as Array<{ action: string; targetPath: string }>;
    // Don't write a .cache folder into the user's own project.
    const repoChunks = buildRepositoryIndex(repoRoot, 80, { persist: !fromEditor });
    const editorPrompt = buildEditorPrompt(activeFile);
    const relevantContext = getRelevantRepoContext(lastUserMessage, repoChunks, 5);

    const toolPrompt = [] as string[];

    if (/list|directory|folders|files/i.test(lastUserMessage)) {
      const targetPath = ".";
      toolCalls.push({ action: "listDirectory", targetPath });
      toolPrompt.push(
        `The assistant may inspect the repository by calling listDirectory on ${targetPath}.`,
      );
    }

    if (/read|show|open|content/i.test(lastUserMessage) && /file|route|page|component/i.test(lastUserMessage)) {
      const targetPath = "app";
      toolCalls.push({ action: "readFile", targetPath });
      toolPrompt.push(
        `The assistant may inspect files under ${targetPath} by calling readFile.`,
      );
    }

    const contextPrompt = relevantContext.length
      ? `
Use the repository context below when answering. If the context is relevant, cite it in your answer.

Repository context:
${relevantContext
  .map(
    (chunk: { path: string; content: string }) => `File: ${chunk.path}\n---\n${chunk.content}`,
  )
  .join("\n\n")}
`
      : "";

    const response = await fetch(`${ollamaHost}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "You are a helpful coding assistant for this repository. Answer concisely, use repository context when available, and prefer practical engineering guidance.",
          },
          ...(contextPrompt
            ? [{ role: "system", content: contextPrompt }]
            : []),
          ...(editorPrompt
            ? [{ role: "system", content: editorPrompt }]
            : []),
          ...(toolPrompt.length
            ? [{ role: "system", content: toolPrompt.join("\n") }]
            : []),
          ...messages.map((message: { role: string; content: string }) => ({
            role: message.role,
            content: message.content,
          })),
        ],
        temperature: 0.7,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          error: data.error?.message || "Ollama request failed.",
        },
        { status: response.status },
      );
    }

    const assistantMessage = data.message?.content ?? "No response received.";

    return NextResponse.json({
      message: {
        role: "assistant",
        content: assistantMessage,
      },
      toolCalls,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown server error.",
      },
      { status: 500 },
    );
  }
}
