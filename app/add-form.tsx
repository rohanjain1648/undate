"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AddForm() {
  const router = useRouter();
  const [linkedin, setLinkedin] = useState("");
  const [instagram, setInstagram] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ linkedin, instagram }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong");
      router.push(`/p/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-5">
      <div className="text-sm font-semibold text-gold">Add a person</div>
      <label className="block">
        <span className="mb-1 block text-xs text-muted">LinkedIn profile</span>
        <input className="input" placeholder="https://www.linkedin.com/in/…" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} required />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted">Instagram (public)</span>
        <input className="input" placeholder="https://www.instagram.com/…" value={instagram} onChange={(e) => setInstagram(e.target.value)} required />
      </label>
      {error && <p className="text-sm text-rose">{error}</p>}
      <button className="btn w-full" disabled={busy}>
        {busy ? "Starting the agent…" : "Create their agent →"}
      </button>
      <p className="text-xs text-muted">The agent reads both profiles (~1 min), builds the profile page, then you can send it on dates with the 25.</p>
    </form>
  );
}
