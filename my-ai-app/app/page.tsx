"use client";

import { useState, useRef, useEffect } from "react";
import { useChat } from "ai/react";

// ─── Types ───
type DocInfo = { id: number; name: string; chunks: number };
type ManualMsg = {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  time: string;
};

const now = () =>
  new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

// ─── Toast ───
function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 animate-slideUp">
      <div className="bg-gray-900/90 backdrop-blur text-white px-5 py-2.5 rounded-full text-sm shadow-xl flex items-center gap-2">
        {msg}
        <button onClick={onClose} className="ml-1 opacity-50 hover:opacity-100">✕</button>
      </div>
    </div>
  );
}

// ─── Spinner ───
function Spinner({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      <span className="w-1.5 h-1.5 bg-current rounded-full animate-dot1 opacity-0" />
      <span className="w-1.5 h-1.5 bg-current rounded-full animate-dot2 opacity-0" />
      <span className="w-1.5 h-1.5 bg-current rounded-full animate-dot3 opacity-0" />
    </span>
  );
}

// ─── Main ───
export default function Home() {
  const [uploading, setUploading] = useState(false);
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [ragEnabled, setRagEnabled] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Agent ──
  const {
    messages: agentMsgs,
    input: agentInput,
    handleInputChange,
    handleSubmit: agentSubmit,
    isLoading: agentLoading,
    stop: agentStop,
    error: agentError,
    reload: agentReload,
  } = useChat({ api: "/api/agent" });

  // ── Manual ──
  const [manualMsgs, setManualMsgs] = useState<ManualMsg[]>([]);
  const [manualInput, setManualInput] = useState("");
  const [manualLoading, setManualLoading] = useState(false);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [agentMsgs, manualMsgs]);

  useEffect(() => {
    fetch("/api/docs").then((r) => r.json()).then(setDocs).catch(() => {});
  }, []);

  useEffect(() => { setRagEnabled(docs.length > 0); }, [docs]);

  // ── Upload ──
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData(); fd.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const d = await res.json();
      if (d.success) {
        setDocs((p) => [...p, { id: d.documentId, name: d.name, chunks: d.chunks }]);
        setToast(`✅ ${d.name} 上传成功`);
      } else { setToast(`❌ ${d.error}`); }
    } catch { setToast("❌ 上传失败"); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  // ── Delete doc ──
  const handleDeleteDoc = async (id: number) => {
    await fetch(`/api/docs?id=${id}`, { method: "DELETE" });
    setDocs((p) => p.filter((d) => d.id !== id));
    setToast("🗑️ 已删除");
  };

  // ── Manual send ──
  const handleManualSend = async () => {
    if (!manualInput.trim() || manualLoading) return;
    const userMsg: ManualMsg = { role: "user", content: manualInput, time: now() };
    setManualMsgs((p) => [...p, userMsg]);
    setManualInput("");
    setManualLoading(true);
    setManualMsgs((p) => [...p, { role: "assistant", content: "", time: now() }]);

    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const ep = ragEnabled && docs.length > 0 ? "/api/rag" : "/api/chat";
      const res = await fetch(ep, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [
          ...manualMsgs.map(m=>({role:m.role,content:m.content})),
          {role:userMsg.role,content:userMsg.content}
        ] }),
        signal: ctrl.signal,
      });
      const reader = res.body?.getReader(); if (!reader) throw new Error("no stream");
      const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const j = line.slice(6); if (j === "[DONE]") continue;
          try {
            const d = JSON.parse(j); const delta = d.choices?.[0]?.delta?.content;
            if (delta) setManualMsgs((p) => { const rest = p.slice(0,-1); const last = p[p.length-1]; return [...rest, {...last, content:last.content+delta}]; });
          } catch {}
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setManualMsgs((p) => [...p.slice(0,-1), { role:"assistant", content:"请求失败", error:true, time:now() }]);
    } finally { setManualLoading(false); abortRef.current = null; }
  };

  const handleRetry = () => {
    const idx = [...manualMsgs].reverse().findIndex((m) => m.role === "user");
    if (idx === -1) return;
    const msg = manualMsgs[manualMsgs.length - 1 - idx];
    setManualMsgs((p) => p.slice(0, -1));
    setManualInput(msg.content);
  };

  const msgs = agentEnabled ? agentMsgs : manualMsgs;
  const loading = agentEnabled ? agentLoading : manualLoading;
  const hasMsgs = Array.isArray(msgs) && msgs.length > 0;

  return (
    <div className="flex flex-col h-dvh bg-gradient-to-br from-slate-50 via-white to-indigo-50/30">
      {/* ━━━ Header ━━━ */}
      <header className="shrink-0 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold shadow-sm shadow-indigo-200">
              AI
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-800 tracking-tight">知识库 AI 助手</h1>
              <p className="text-xs text-gray-400">RAG · Agent · 流式对话</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Upload */}
            <input ref={fileRef} type="file" accept="application/pdf" onChange={handleUpload} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                         bg-gradient-to-r from-emerald-500 to-teal-500 text-white
                         hover:from-emerald-600 hover:to-teal-600
                         disabled:opacity-50 transition-all shadow-sm shadow-emerald-200">
              {uploading ? <Spinner /> : "📄"}
              {uploading ? "解析中" : "上传"}
            </button>

            {/* Agent toggle */}
            <button onClick={() => { setAgentEnabled(!agentEnabled); if (!agentEnabled) setRagEnabled(false); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                agentEnabled
                  ? "bg-gradient-to-r from-purple-500 to-violet-500 text-white shadow-sm shadow-purple-200"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
              🤖 Agent
            </button>

            {/* RAG toggle */}
            {docs.length > 0 && !agentEnabled && (
              <button onClick={() => setRagEnabled(!ragEnabled)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  ragEnabled
                    ? "bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-sm shadow-blue-200"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                📚 RAG
              </button>
            )}
          </div>
        </div>

        {/* Docs pills */}
        {docs.length > 0 && (
          <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-2 flex flex-wrap gap-1.5">
            {docs.map((doc) => (
              <span key={doc.id}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs
                           bg-emerald-50 text-emerald-700 border border-emerald-200/50
                           hover:shadow-sm transition-shadow">
                <span className="w-1 h-1 rounded-full bg-emerald-500" />
                {doc.name} · {doc.chunks} 片段
                <button onClick={() => handleDeleteDoc(doc.id)}
                  className="text-emerald-400 hover:text-red-500 ml-0.5 transition-colors">×</button>
              </span>
            ))}
          </div>
        )}
      </header>

      {/* ━━━ Messages ━━━ */}
      <main className="flex-1 overflow-y-auto scroll-smooth">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
          {/* Empty */}
          {!hasMsgs && !loading && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center text-3xl mb-6 shadow-sm">
                {docs.length > 0 ? "📚" : "✨"}
              </div>
              <h2 className="text-xl font-bold text-gray-700 mb-2 tracking-tight">
                {docs.length > 0 ? "文档已就绪" : "上传文档，开始提问"}
              </h2>
              <p className="text-gray-400 text-sm max-w-xs leading-relaxed">
                {docs.length > 0
                  ? "AI 将基于你的 PDF 内容回答问题，支持多文档检索"
                  : "支持 PDF 文件，上传后自动解析并建立知识库索引"}
              </p>
              <div className="flex gap-2 mt-5 flex-wrap justify-center">
                {agentEnabled && <Hint label="123×456 等于多少" />}
                {ragEnabled && <Hint label="这篇文章的核心观点是什么" />}
                {!agentEnabled && docs.length === 0 && <Hint label="直接聊天，无需文档" />}
              </div>
            </div>
          )}

          {/* Agent messages */}
          {agentEnabled && agentMsgs.map((m) => (
            <Bubble key={m.id} role={m.role as "user"|"assistant"} content={m.content} time="" loading={agentLoading && m === agentMsgs[agentMsgs.length-1] && m.role==="assistant" && !m.content} />
          ))}

          {/* Manual messages */}
          {!agentEnabled && manualMsgs.map((m, i) => (
            <Bubble key={i} role={m.role} content={m.content} time={m.time}
              error={m.error} onRetry={m.error ? handleRetry : undefined}
              loading={manualLoading && i===manualMsgs.length-1 && m.role==="assistant" && !m.content && !m.error} />
          ))}

          {/* Loading indicator when no assistant msg yet */}
          {loading && hasMsgs && (() => { const last = Array.isArray(msgs) ? msgs[msgs.length-1] : null; return last && "role" in last && last.role === "user" ? <Bubble role="assistant" content="" time="" loading /> : null; })()}

          {/* Agent error */}
          {agentError && (
            <div className="flex justify-center">
              <div className="bg-red-50 text-red-600 px-4 py-2.5 rounded-xl text-sm border border-red-100 flex items-center gap-2 shadow-sm">
                <span>⚠️</span> {agentError.message || "请求失败"}
                <button onClick={() => agentReload()} className="font-semibold underline hover:text-red-800">重试</button>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      {/* ━━━ Input ━━━ */}
      <footer className="shrink-0 bg-white/80 backdrop-blur-md border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3">
          {agentEnabled ? (
            <form onSubmit={agentSubmit} className="flex gap-2 items-end">
              <div className="flex-1 relative">
                <input
                  className="w-full border-0 bg-gray-50 rounded-2xl px-4 py-3 pr-4 text-sm
                             focus:outline-none focus:ring-2 focus:ring-purple-400/50 focus:bg-white
                             placeholder:text-gray-300 transition-all"
                  placeholder="试试 123×456 / 北京天气…"
                  value={agentInput} onChange={handleInputChange} disabled={agentLoading} />
              </div>
              {agentLoading ? (
                <button type="button" onClick={() => agentStop()}
                  className="bg-red-500 text-white px-4 py-3 rounded-2xl hover:bg-red-600 text-sm font-medium transition-all shrink-0 shadow-sm shadow-red-200">
                  停止
                </button>
              ) : (
                <button type="submit" disabled={!agentInput.trim()}
                  className="bg-gradient-to-r from-purple-500 to-violet-500 text-white px-5 py-3 rounded-2xl
                             hover:from-purple-600 hover:to-violet-600 disabled:opacity-30 text-sm font-medium
                             transition-all shrink-0 shadow-sm shadow-purple-200">
                  发送
                </button>
              )}
            </form>
          ) : (
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <input
                  className="w-full border-0 bg-gray-50 rounded-2xl px-4 py-3 text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:bg-white
                             placeholder:text-gray-300 transition-all"
                  placeholder={ragEnabled && docs.length>0 ? "对文档内容提问…" : "输入消息…"}
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); handleManualSend(); } }}
                  disabled={manualLoading} />
              </div>
              {manualLoading ? (
                <button type="button" onClick={() => abortRef.current?.abort()}
                  className="bg-red-500 text-white px-4 py-3 rounded-2xl hover:bg-red-600 text-sm font-medium transition-all shrink-0 shadow-sm shadow-red-200">
                  停止
                </button>
              ) : (
                <button type="button" onClick={handleManualSend} disabled={!manualInput.trim()}
                  className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white px-5 py-3 rounded-2xl
                             hover:from-blue-600 hover:to-indigo-600 disabled:opacity-30 text-sm font-medium
                             transition-all shrink-0 shadow-sm shadow-blue-200">
                  发送
                </button>
              )}
            </div>
          )}
          <p className="text-center text-[10px] text-gray-300 mt-2 hidden sm:block">
            Enter 发送 · Shift+Enter 换行
          </p>
        </div>
      </footer>

      {/* Toast */}
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

// ━━━ Bubble Component ━━━
function Bubble({
  role, content, time, error, loading, onRetry,
}: {
  role: "user" | "assistant";
  content: string;
  time: string;
  error?: boolean;
  loading?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className={`flex gap-3 ${role === "user" ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-sm ${
        role === "user"
          ? "bg-gradient-to-br from-sky-400 to-blue-500 text-white"
          : "bg-gradient-to-br from-violet-400 to-purple-500 text-white"
      }`}>
        {role === "user" ? "👤" : "🤖"}
      </div>

      {/* Content */}
      <div className={`group max-w-[80%] sm:max-w-[70%] ${
        role === "user" ? "items-end" : "items-start"
      }`}>
        <div className={`px-4 py-2.5 rounded-2xl text-sm sm:text-[15px] leading-relaxed whitespace-pre-wrap break-words ${
          role === "user"
            ? "bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-tr-md shadow-sm shadow-blue-200"
            : error
              ? "bg-red-50 text-red-700 border border-red-100 rounded-tl-md"
              : "bg-white text-gray-700 rounded-tl-md shadow-sm border border-gray-100"
        }`}>
          {loading ? <Spinner className="text-gray-400" /> : content}
          {error && onRetry && (
            <div className="mt-2">
              <button onClick={onRetry}
                className="text-xs bg-red-100 hover:bg-red-200 text-red-600 px-3 py-1 rounded-lg font-medium transition-colors">
                点击重试
              </button>
            </div>
          )}
        </div>
        {time && !error && (
          <span className="text-[10px] text-gray-300 mt-0.5 block px-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {time}
          </span>
        )}
      </div>
    </div>
  );
}

// ━━━ Hint Pill ━━━
function Hint({ label }: { label: string }) {
  return (
    <span className="px-3 py-1.5 rounded-full text-xs bg-white border border-gray-100 text-gray-400 shadow-sm">
      {label}
    </span>
  );
}
