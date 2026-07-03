import { TOOL_DEFINITIONS, executeTool } from "@/lib/tools";

const DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions";
const MAX_STEPS = 5;
const STEP_TIMEOUT_MS = 30000;  // 单步超时 30 秒
const MAX_TOKENS = 8000;        // 总 Token 上限

type DeepSeekMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
};

export async function POST(req: Request) {
  const { messages } = await req.json();

  // DeepSeek 要求的消息格式
  const apiMessages: DeepSeekMessage[] = [
    {
      role: "system",
      content:
        "你是一个能使用工具的AI助手。根据用户需求选择合适的工具。计算题用 calculator，查天气用 get_weather。用中文回答。",
    },
    ...messages.map(
      (m: { role: string; content: string }): DeepSeekMessage => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })
    ),
  ];

  // ─── Agent Loop ───
  let step = 0;
  let totalTokens = 0;

  while (step < MAX_STEPS) {
    step++;

    const response = await fetch(DEEPSEEK_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: apiMessages,
        tools: TOOL_DEFINITIONS,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),  // ← 超时控制
    });

    const data = await response.json();
    const assistantMsg = data.choices?.[0]?.message;

    if (!assistantMsg) {
      return Response.json({ error: "AI 无响应" }, { status: 500 });
    }

    // Token 消耗监控
    totalTokens += data.usage?.total_tokens ?? 0;
    if (totalTokens > MAX_TOKENS) {
      return Response.json(
        { error: `Token 消耗已达上限 (${totalTokens}/${MAX_TOKENS})，已终止` },
        { status: 500 }
      );
    }

    // 有 tool_calls？执行工具然后继续循环
    if (assistantMsg.tool_calls?.length) {
      // 把 AI 的 tool_call 消息放入历史
      apiMessages.push(assistantMsg);

      // 执行每个工具，把结果放入历史
      for (const tc of assistantMsg.tool_calls) {
        const fnName = tc.function.name;
        const fnArgs = JSON.parse(tc.function.arguments || "{}");

        const execResult = await executeTool(fnName, fnArgs);

        apiMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: execResult.success
            ? execResult.result
            : `错误: ${execResult.result}`,
        });
      }

      // 继续循环，让 DeepSeek 基于工具结果生成回答
      continue;
    }

    // 没有 tool_calls → 最终回答，把已有内容转成 SSE 流返回
    const answer = assistantMsg.content || "";

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // 构造一个 SSE chunk，让前端流式显示
        const chunk = {
          choices: [{ delta: { content: answer } }],
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // 超过最大步数
  return Response.json({ error: "Agent 推理步骤过多，已终止" }, { status: 500 });
}
