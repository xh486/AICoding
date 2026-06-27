export async function POST(req: Request) {
  const { messages } = await req.json();

  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content: "你是一个有用的AI助手，用中文回答。回答简洁清晰。",
        },
        ...messages,
      ],
      temperature: 0.7,
      stream: true,
    }),
  });

  // 把 DeepSeek 的流直接转发给前端
  return new Response(response.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
