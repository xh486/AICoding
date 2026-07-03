# AI 知识库助手

一个集成了聊天、RAG文档问答、Agent工具调用的全栈AI应用。

**在线地址**：[https://ai-coding-nine-psi.vercel.app](https://ai-coding-nine-psi.vercel.app)

---

## 功能

| 模式 | 功能 | 说明 |
|------|------|------|
| 💬 自由聊天 | DeepSeek 对话 + 流式输出 | 支持多轮对话、中断生成 |
| 📚 文档模式 | PDF 上传 + RAG 知识库问答 | 上传文档后基于内容回答 |
| 🤖 Agent 模式 | 工具调用 + 多步推理 | AI 可调用计算器、查天气等工具 |

---

## 技术架构

```
┌──────────────────────────────────────────┐
│                  前端 (page.tsx)           │
│  Next.js 16 + React + Tailwind CSS       │
│  三种模式一键切换                           │
└──────────────┬───────────────────────────┘
               │ SSE 流式通信
┌──────────────┴───────────────────────────┐
│              API Routes                   │
│  /api/chat    — 普通聊天                   │
│  /api/rag     — RAG 文档问答              │
│  /api/agent   — Agent 工具调用            │
│  /api/upload  — PDF 上传处理              │
│  /api/docs    — 文档管理 (CRUD)           │
└──────┬──────────────────┬────────────────┘
       │                  │
  ┌────▼────┐      ┌──────▼──────┐
  │ DeepSeek│      │  Supabase   │
  │ (LLM)   │      │  pgvector   │
  │ 对话/工具│      │  向量数据库  │
  └─────────┘      └──────┬──────┘
                          │
                   ┌──────▼──────┐
                   │ SiliconFlow │
                   │ (Embedding) │
                   │ 向量化文本   │
                   └─────────────┘
```

### RAG 优化

- **HyDE**（假设文档嵌入）：用 AI 生成的假设答案做检索，而非原始问题，提高匹配精度
- **Re-ranking**（重排序）：LLM 对向量检索结果二次打分，筛选最相关的片段
- **级联降级**：每一步失败都有兜底方案（HyDE 失败 → 原问题检索；Re-rank 失败 → 向量排序）

### 3种模式

| 对比 | /api/chat | /api/rag | /api/agent |
|------|-----------|----------|------------|
| 调用次数 | 1 | 3-4 | 2-N（循环） |
| 流式 | ✅ 原生流式 | ✅ 原生流式 | 非流式循环 + 包装流式 |
| 传 tools | ❌ | ❌ | ✅ |
| 温度 | 0.7 | 0.5 | 0.3 |

---

## 技术栈

- **框架**：Next.js 16 (App Router + Turbopack)
- **语言**：TypeScript
- **样式**：Tailwind CSS v4
- **LLM**：DeepSeek Chat API
- **Embedding**：SiliconFlow BAAI/bge-large-zh-v1.5 (1024维)
- **向量数据库**：Supabase pgvector
- **PDF 解析**：PyPDF2 (Python)
- **部署**：Vercel

---

## 本地运行

```bash
# 1. 安装依赖
npm install

# 2. 安装 Python PDF 解析库
pip install PyPDF2

# 3. 配置环境变量（创建 .env.local）
DEEPSEEK_API_KEY=sk-xxx
SILICONFLOW_API_KEY=sk-xxx
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...

# 4. 启动
npm run dev
```

## 数据库初始化

在 Supabase SQL Editor 执行：

```sql
create extension if not exists vector;

create table documents (
  id bigserial primary key,
  name text not null,
  created_at timestamptz default now()
);

create table chunks (
  id bigserial primary key,
  document_id bigint references documents(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(1024)
);

create or replace function search_chunks(
  query_embedding vector(1024),
  match_count int default 5
) returns table(
  id bigint, content text, document_name text, similarity float
) as $$
begin
  return query
  select c.id, c.content, d.name as document_name,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  join documents d on d.id = c.document_id
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$ language plpgsql stable;
```

---

## 项目结构

```
my-ai-app/
├── app/
│   ├── page.tsx              ← 前端主页面（三模式切换）
│   ├── layout.tsx             ← 根布局
│   └── api/
│       ├── chat/route.ts      ← 普通聊天
│       ├── rag/route.ts       ← RAG（HyDE + Re-rank）
│       ├── agent/route.ts     ← Agent（Function Calling + Loop）
│       ├── upload/route.ts    ← PDF 上传（Python 解析）
│       └── docs/route.ts      ← 文档 CRUD
├── lib/
│   ├── supabase.ts            ← 数据库客户端
│   ├── tools.ts               ← Agent 工具定义 + 执行
│   └── extract_pdf.py         ← Python PDF 解析
└── .env.local                 ← 密钥（不入库）
```

---

## 学习笔记

### 函数调用原理

AI 不直接回答，而是决定"我想调什么工具、参数是什么"。代码负责执行工具，结果扔回给 AI。

### RAG 检索优化思路

1. 基础：问题 → 向量 → 搜索
2. HyDE：问题 → AI生成假设答案 → 向量 → 搜索（匹配度更高）
3. Re-rank：搜索 top10 → LLM 精排 → top5（更精准）

> chunk_size 在 `app/api/upload/route.ts` 第8行可调：200（精准但碎片）/ 500（默认）/ 1000（完整但模糊）

### Agent 循环

```
while (step < MAX_STEPS) {
  询问 LLM → 是否有 tool_calls? → 执行 → 继续
         → 若无 tool_calls? → 结束，输出答案
}
```

`MAX_STEPS = 5` 防止无限循环。

---

## 已知限制

- BAAI/bge-large-zh-v1.5 对非中文文本效果较差
- 扫描件 PDF（纯图片）无法提取文字
- Agent 仅支持 calculator 和 get_weather 两个工具
