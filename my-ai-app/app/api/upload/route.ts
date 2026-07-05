import { supabase } from "@/lib/supabase";
import * as pdfjs from "pdfjs-dist";

const EMBEDDING_API = "https://api.siliconflow.cn/v1/embeddings";
const EMBEDDING_MODEL = "BAAI/bge-large-zh-v1.5";
const CHUNK_SIZE = 500;

function splitText(text: string, size: number): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[。！？\n])/);
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length > size && current.length > 0) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data }).promise;

  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    texts.push(pageText);
  }

  return texts.join("\n").trim();
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File;

  if (!file || file.type !== "application/pdf") {
    return Response.json({ error: "请上传 PDF 文件" }, { status: 400 });
  }

  // 1. 用 pdfjs-dist 提取 PDF 文字（纯 JS，无需 Python）
  const buffer = Buffer.from(await file.arrayBuffer());

  let fullText: string;
  try {
    fullText = await extractPdfText(buffer);
  } catch {
    return Response.json({ error: "PDF 解析失败" }, { status: 500 });
  }

  if (!fullText) {
    return Response.json({ error: "PDF 中没有可提取的文字" }, { status: 400 });
  }

  // 2. 切块
  const chunks = splitText(fullText, CHUNK_SIZE);

  // 3. 生成 Embedding
  const embRes = await fetch(EMBEDDING_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SILICONFLOW_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: chunks }),
  });

  if (!embRes.ok) {
    return Response.json({ error: "Embedding 失败" }, { status: 500 });
  }

  const embData = await embRes.json();
  const vectors: number[][] = embData.data.map(
    (d: { embedding: number[] }) => d.embedding
  );

  // 4. 存入数据库
  const { data: newDoc, error: docErr } = await supabase
    .from("documents")
    .insert({ name: file.name })
    .select()
    .single();

  if (docErr) {
    return Response.json({ error: "文档存储失败" }, { status: 500 });
  }

  const chunkRows = chunks.map((content, i) => ({
    document_id: newDoc.id,
    chunk_index: i,
    content,
    embedding: vectors[i],
  }));

  const { error: chunkErr } = await supabase.from("chunks").insert(chunkRows);

  if (chunkErr) {
    return Response.json({ error: "分块存储失败" }, { status: 500 });
  }

  return Response.json({
    success: true,
    documentId: newDoc.id,
    name: file.name,
    chunks: chunks.length,
    preview: fullText.slice(0, 200),
  });
}
