import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("documents")
    .select("id, name");

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const docs = await Promise.all(
    (data as { id: number; name: string }[]).map(async (doc) => {
      const { count } = await supabase
        .from("chunks")
        .select("*", { count: "exact", head: true })
        .eq("document_id", doc.id);
      return { id: doc.id, name: doc.name, chunks: count ?? 0 };
    })
  );

  return Response.json(docs);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "缺少文档 ID" }, { status: 400 });

  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
