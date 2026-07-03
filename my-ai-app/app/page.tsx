"use client";

import { useState, useRef, useEffect } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type DocInfo = {
  id: number;
  name: string;
  chunks: number;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [ragEnabled, setRagEnabled] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/docs")
      .then((r) => r.json())
      .then(setDocs)
      .catch(() => {});
  }, []);

  // 文档变化时自动开启 RAG
  useEffect(() => {
    setRagEnabled(docs.length > 0);
  }, [docs]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        setDocs((prev) => [...prev, { id: data.documentId, name: data.name, chunks: data.chunks }]);
      } else {
        alert("上传失败: " + data.error);
      }
    } catch {
      alert("上传失败，请重试");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDeleteDoc = async (id: number) => {
    try {
      await fetch(`/api/docs?id=${id}`, { method: "DELETE" });
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch {
      alert("删除失败");
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: "user", content: input };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // 模式优先级：Agent > RAG > 聊天
      const endpoint = agentEnabled
        ? "/api/agent"
        : ragEnabled && docs.length > 0
        ? "/api/rag"
        : "/api/chat";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages }),
        signal: controller.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);
          if (jsonStr === "[DONE]") continue;

          try {
            const chunk = JSON.parse(jsonStr);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                const rest = prev.slice(0, -1);
                return [...rest, { ...last, content: last.content + delta }];
              });
            }
          } catch { /* 不完整 JSON */ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        const rest = prev.slice(0, -1);
        return [...rest, { ...last, content: last.content || "请求失败，请重试。" }];
      });
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => abortRef.current?.abort();

  return (
    <main className="flex flex-col items-center p-8 w-full max-w-3xl mx-auto">
      <h1 className="text-4xl font-bold mb-4">知识库 AI 助手</h1>
      <p className="text-gray-500 mb-6">上传文档 · 基于内容问答</p>

      {/* 上传区 + 文档列表 + RAG 开关 */}
      <div className="w-full mb-6 space-y-3">
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            onChange={handleUpload}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm"
          >
            {uploading ? "上传中..." : "📄 上传 PDF"}
          </button>

          {/* Agent 开关 */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button
              onClick={() => {
                setAgentEnabled(!agentEnabled);
                if (!agentEnabled) setRagEnabled(false); // Agent 和 RAG 互斥
              }}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                agentEnabled ? "bg-purple-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                  agentEnabled ? "left-5" : "left-0.5"
                }`}
              />
            </button>
            <span className="text-sm text-gray-600">
              {agentEnabled ? "🤖 Agent 模式" : ""}
            </span>
          </label>

          {/* RAG 开关 */}
          {docs.length > 0 && !agentEnabled && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <button
                onClick={() => setRagEnabled(!ragEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  ragEnabled ? "bg-blue-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    ragEnabled ? "left-5" : "left-0.5"
                  }`}
                />
              </button>
              <span className="text-sm text-gray-600">
                {ragEnabled ? "📚 文档模式" : "💬 自由聊天"}
              </span>
            </label>
          )}
        </div>

        {docs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {docs.map((doc) => (
              <span
                key={doc.id}
                className="inline-flex items-center gap-1 bg-green-50 text-green-700 px-3 py-1 rounded-full text-sm border border-green-200 group"
              >
                📄 {doc.name}（{doc.chunks}片段）
                <button
                  onClick={() => handleDeleteDoc(doc.id)}
                  className="ml-1 text-green-400 hover:text-red-500 hover:bg-red-50 rounded-full w-4 h-4 inline-flex items-center justify-center text-xs"
                  title="删除文档"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 消息区 */}
      <div className="w-full border rounded-lg p-4 min-h-[350px] mb-4 overflow-auto">
        {messages.length === 0 && !loading ? (
          <p className="text-gray-400 text-center mt-36">
            {docs.length > 0 ? "已加载文档，开始提问吧" : "上传一份 PDF，然后开始提问"}
          </p>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`mb-3 p-3 rounded-lg whitespace-pre-wrap ${
                msg.role === "user" ? "bg-blue-100 ml-8" : "bg-gray-100 mr-8"
              }`}
            >
              {msg.content}
            </div>
          ))
        )}
        {loading && <p className="text-gray-400 text-sm">AI 思考中...</p>}
      </div>

      {/* 输入区 */}
      <div className="w-full flex gap-2">
        <input
          className="flex-1 border rounded-lg px-4 py-2 disabled:opacity-50"
          placeholder={
            agentEnabled
              ? "试试：123*456 等于多少 / 北京天气怎么样..."
              : ragEnabled && docs.length > 0
              ? "对文档内容提问..."
              : "输入消息..."
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          disabled={loading}
        />
        {loading ? (
          <button
            className="bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600"
            onClick={handleStop}
          >
            停止
          </button>
        ) : (
          <button
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            onClick={handleSend}
            disabled={loading}
          >
            发送
          </button>
        )}
      </div>
    </main>
  );
}
