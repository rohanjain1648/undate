export function parseLinkedIn(input: string): string | null {
  try {
    const u = new URL(input.trim().startsWith("http") ? input.trim() : `https://${input.trim()}`);
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/in\/([^/?#]+)/i);
    if (!m) return null;
    return `https://www.linkedin.com/in/${decodeURIComponent(m[1])}/`;
  } catch {
    return null;
  }
}

export function parseInstagram(input: string): { url: string; username: string } | null {
  try {
    const raw = input.trim();
    if (/^@?[a-z0-9._]{1,30}$/i.test(raw)) {
      const username = raw.replace(/^@/, "");
      return { url: `https://www.instagram.com/${username}/`, username };
    }
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/([a-z0-9._]{1,30})\/?$/i);
    if (!m || ["p", "reel", "reels", "explore", "stories", "accounts"].includes(m[1].toLowerCase())) return null;
    return { url: `https://www.instagram.com/${m[1]}/`, username: m[1] };
  } catch {
    return null;
  }
}
