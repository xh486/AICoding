"use client";

import { useState, useRef } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: "user", content: input };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    // 先加一个空的 assistant 消息，后面逐字填充
    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
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

        // 解析 SSE 数据
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6); // 去掉 "data: "
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
          } catch {
            // 忽略不完整的 JSON
          }
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

  const handleStop = () => {
    abortRef.current?.abort();
  };

  return (
    <main className="flex flex-col items-center p-8 w-full max-w-3xl mx-auto">
      <h1 className="text-4xl font-bold mb-4">我的 AI 助手</h1>
      <p className="text-gray-500 mb-8">DeepSeek · 流式聊天</p>

      <div className="w-full border rounded-lg p-4 min-h-[400px] mb-4 overflow-auto">
        {messages.length === 0 && !loading ? (
          <p className="text-gray-400 text-center mt-40">开始对话吧</p>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`mb-3 p-3 rounded-lg whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-blue-100 ml-8"
                  : "bg-gray-100 mr-8"
              }`}
            >
              {msg.content}
            </div>
          ))
        )}
        {loading && (
          <p className="text-gray-400 text-sm">AI 思考中...</p>
        )}
      </div>

      <div className="w-full flex gap-2">
        <input
          className="flex-1 border rounded-lg px-4 py-2 disabled:opacity-50"
          placeholder="输入消息..."
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
