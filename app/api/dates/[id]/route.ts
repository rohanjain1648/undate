import { NextResponse } from "next/server";
import { db, must } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: date } = await db().from("dates").select("*").eq("id", id).maybeSingle();
  if (!date) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const people = await must(db().from("people").select("id,name,headline,photo_url").in("id", [date.a_id, date.b_id]));
  return NextResponse.json({ date, people });
}
