import { supabase } from "@/lib/supabase";

const EMBEDDING_API = "https://api.siliconflow.cn/v1/embeddings";
const EMBEDDING_MODEL = "BAAI/bge-large-zh-v1.5";
const DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions";

// 可配置参数
const VECTOR_SEARCH_COUNT = 10; // 向量检索取几条（稍多，后面重排序筛选）
const FINAL_CHUNK_COUNT = 5;    // 最终塞给 LLM 的块数

// ─── Embedding ───
async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(EMBEDDING_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SILICONFLOW_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: [text] }),
  });
  const data = await res.json();
  return data.data[0].embedding;
}

// ─── HyDE：让 AI 假设一个答案，用答案搜 ───
async function generateHypotheticalAnswer(question: string): Promise<string> {
  const res = await fetch(DEEPSEEK_API, {
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
          content:
            "你是一个文档助手。根据用户问题，假设性地生成一段可能在文档中出现的答案。只输出答案内容，不要解释，不要说你不知道。",
        },
        { role: "user", content: question },
      ],
      temperature: 0.3,
      max_tokens: 256,
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || question;
}

// ─── Re-ranking：让 LLM 给检索结果打分 ───
async function reRank(
  question: string,
  chunks: { content: string; document_name: string; similarity: number }[]
): Promise<typeof chunks> {
  const numbered = chunks
    .map((c, i) => `[${i}] (文档《${c.document_name}》，向量相似度${c.similarity.toFixed(2)})\n${c.content}`)
    .join("\n\n");

  const res = await fetch(DEEPSEEK_API, {
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
          content:
            `你是一个检索质量评估器。根据用户问题，对以下${chunks.length}个文档片段进行重排序。` +
            "选出最相关的5个，按相关性从高到低输出它们的编号，格式：4,2,7,1,5。只输出编号，不要解释。",
        },
        { role: "user", content: `用户问题：${question}\n\n文档片段：\n${numbered}` },
      ],
      temperature: 0,
      max_tokens: 50,
    }),
  });

  const data = await res.json();
  const ranked = data.choices?.[0]?.message?.content || "";

  // 解析 "4,2,7,1,5" → 按顺序取对应的 chunk
  const indices = ranked
    .split(/[,\s]+/)
    .map(Number)
    .filter((n: number) => !isNaN(n) && n >= 0 && n < chunks.length)
    .slice(0, FINAL_CHUNK_COUNT);

  return indices.length > 0 ? indices.map((i: number) => chunks[i]) : chunks.slice(0, FINAL_CHUNK_COUNT);
}

// ─── 主入口 ───
export async function POST(req: Request) {
  const { messages } = await req.json();
  const question = messages[messages.length - 1].content;

  // 边界检查
  if (!question.trim()) {
    return Response.json({ error: "问题不能为空" }, { status: 400 });
  }

  // 1. HyDE：用假设答案搜，而不是用原问题搜
  const hypothetical = await generateHypotheticalAnswer(question);
  const qEmbedding = await getEmbedding(hypothetical);

  // 2. 向量检索 — 多取几条，后面重排序筛选
  const { data: chunks, error } = await supabase.rpc("search_chunks", {
    query_embedding: qEmbedding,
    match_count: VECTOR_SEARCH_COUNT,
  });

  if (error) {
    return Response.json({ error: "检索失败: " + error.message }, { status: 500 });
  }

  if (!chunks?.length) {
    return Response.json({ error: "文档中没有相关内容" }, { status: 404 });
  }

  // 3. Re-ranking — 让 LLM 精排
  const reranked = await reRank(question, chunks);

  // 4. 拼接上下文
  const context = reranked
    .map((c, i) => `[片段${i + 1}，文档《${c.document_name}》]\n${c.content}`)
    .join("\n\n");

  // 5. 构造 Prompt
  const systemPrompt = `你是一个知识库助手。根据以下文档内容回答用户问题。
如果文档中没有相关信息，请诚实说"文档中没有提到"。

## 参考文档
${context}

## 回答规则
- 基于文档内容回答，不编造
- 引用具体文档名称
- 用中文回答`;

  // 6. 流式生成
  const response = await fetch(DEEPSEEK_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.5,
      stream: true,
    }),
  });

  return new Response(response.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
