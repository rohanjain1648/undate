"use client";

import { useEffect, useRef, useState } from "react";

export function Avatar({ src, name, size = 48 }: { src?: string | null; name?: string | null; size?: number }) {
  const initials = (name ?? "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("");
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name ?? ""} width={size} height={size} className="shrink-0 rounded-full border border-line object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="flex shrink-0 items-center justify-center rounded-full border border-line bg-card2 font-serif text-gold" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </div>
  );
}

/** Poll a JSON endpoint every `ms` while `active(data)` is true. */
export function usePoll<T>(url: string, ms: number, active: (d: T | null) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  });
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? res.statusText);
        if (stop) return;
        setData(json);
        setError(null);
        if (activeRef.current(json)) timer = setTimeout(tick, ms);
      } catch (e) {
        if (stop) return;
        setError(e instanceof Error ? e.message : String(e));
        timer = setTimeout(tick, ms * 2);
      }
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [url, ms]);
  return { data, error };
}

export function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink">
      <div className="h-full rounded-full bg-gradient-to-r from-gold-dim to-gold" style={{ width: `${Math.max(2, (value / max) * 100)}%` }} />
    </div>
  );
}

export function Dots() {
  return (
    <span className="inline-flex gap-1 align-middle">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </span>
  );
}

export const seeAgainLabel: Record<string, string> = { yes: "wants a 2nd date", maybe: "maybe", no: "not a match" };
