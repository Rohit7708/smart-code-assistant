"use client";

import { FormEvent, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

type ToolCall = {
  action: string;
  targetPath: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
};

const initialMessages: Message[] = [
  {
    role: "assistant",
    content:
      "Hello! I’m your coding assistant. Ask me about debugging, architecture, or next steps for this project.",
  },
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [statusMessage, setStatusMessage] = useState(
    "Make sure Ollama is running locally and that the model is installed to enable live responses.",
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!input.trim() || isLoading) {
      return;
    }

    const userMessage: Message = {
      role: "user",
      content: input.trim(),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, toolCalls }),
      });

      const data = await response.json();

      if (!response.ok) {
        setStatusMessage(data.error || "Something went wrong while contacting the assistant.");
        throw new Error(data.error || "Something went wrong while contacting the assistant.");
      }

      setStatusMessage("Live responses are enabled.");

      if (data.toolCalls?.length) {
        setToolCalls(data.toolCalls);
      }

      setMessages((previous) => [...previous, data.message]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong while contacting the assistant.";

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: message,
        },
      ]);
      setStatusMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg shadow-black/20 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-cyan-400">Phase 1</p>
            <h1 className="text-2xl font-semibold text-white">Personal Coding Assistant</h1>
          </div>
          <p className="max-w-xl text-sm text-slate-400">
            Chat with an LLM, keep history, and render rich markdown with syntax highlighting.
          </p>
        </header>

        <main className="flex-1 overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/80 shadow-2xl shadow-black/20">
          <div className="border-b border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
            {statusMessage}
          </div>
          <div className="flex h-[74vh] flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
              {toolCalls.length ? (
                <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm text-cyan-200">
                  <p className="font-semibold">Tool activity</p>
                  <ul className="mt-2 space-y-1">
                    {toolCalls.map((toolCall, index) => (
                      <li key={`${toolCall.action}-${index}`}>
                        • {toolCall.action} on {toolCall.targetPath}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm sm:max-w-[80%] ${
                      message.role === "user"
                        ? "bg-cyan-500 text-slate-950"
                        : "bg-slate-800 text-slate-100"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <div className="prose prose-invert max-w-none prose-code:before:content-none prose-code:after:content-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap">{message.content}</div>
                    )}
                  </div>
                </div>
              ))}

              {isLoading ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-slate-800 px-4 py-3 text-sm text-slate-300">
                    Thinking…
                  </div>
                </div>
              ) : null}
            </div>

            <form onSubmit={handleSubmit} className="border-t border-slate-800 bg-slate-950/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  rows={3}
                  placeholder="Ask the assistant anything..."
                  className="flex-1 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500 focus:border-cyan-400"
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isLoading ? "Sending..." : "Send"}
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
