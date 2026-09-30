import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/** Unwrap a Supabase response: throw on error or missing data. Rows are loosely typed (no generated DB types). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function must(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<any> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  if (data === null || data === undefined) throw new Error("No data");
  return data;
}

/** Append a progress line to a person's log (drives the live progress UI). */
export async function logStep(personId: string, step: string, msg: string, status?: string) {
  const { data } = await db().from("people").select("log").eq("id", personId).single();
  const log = [...((data?.log as unknown[]) ?? []), { t: new Date().toISOString(), step, msg }];
  const patch: Record<string, unknown> = { log };
  if (status) patch.status = status;
  await db().from("people").update(patch).eq("id", personId);
}
