import { ApifyClient } from "apify-client";
import type { InstagramData, LinkedInData } from "./types";

function apify(): ApifyClient {
  if (!process.env.APIFY_TOKEN) throw new Error("Missing APIFY_TOKEN");
  return new ApifyClient({ token: process.env.APIFY_TOKEN });
}

async function runActor(actorId: string, input: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const run = await apify().actor(actorId).call(input, { waitSecs: 240 });
  if (run.status !== "SUCCEEDED") throw new Error(`Apify ${actorId} run ${run.status}`);
  const { items } = await apify().dataset(run.defaultDatasetId).listItems({ limit: 5 });
  return items as Record<string, unknown>[];
}

// ---------- tolerant field helpers (different actors name fields differently) ----------
type Any = Record<string, unknown>;
const str = (...vals: unknown[]): string => {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
};
const num = (...vals: unknown[]): number | null => {
  for (const v of vals) if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
};
const arr = (...vals: unknown[]): Any[] => {
  for (const v of vals) if (Array.isArray(v)) return v as Any[];
  return [];
};
const obj = (v: unknown): Any => (v && typeof v === "object" ? (v as Any) : {});

// ---------- LinkedIn ----------
export async function scrapeLinkedIn(url: string): Promise<{ raw: Any; data: LinkedInData }> {
  const actor = process.env.APIFY_LINKEDIN_ACTOR || "harvestapi/linkedin-profile-scraper";
  // harvestapi takes `urls`; other LinkedIn actors (e.g. dev_fusion) take `profileUrls`.
  const input = actor.startsWith("harvestapi/") ? { urls: [url] } : { profileUrls: [url] };
  const items = await runActor(actor, input);
  const raw = items.find((i) => !i.error) ?? items[0];
  if (!raw) throw new Error("LinkedIn scrape returned nothing (is the profile public?)");
  if (raw.error && !raw.headline) throw new Error(`LinkedIn scrape error: ${String(raw.error)}`);
  return { raw, data: normalizeLinkedIn(url, raw) };
}

export function normalizeLinkedIn(url: string, r: Any): LinkedInData {
  const loc = obj(r.location);
  const name = str(r.fullName, r.name, [r.firstName, r.lastName].filter(Boolean).join(" "));
  return {
    url,
    name,
    headline: str(r.headline, r.occupation, r.jobTitle),
    location: str(loc.linkedinText, obj(loc.parsed).text, r.addressWithCountry, r.location, r.geoLocationName),
    about: str(r.about, r.summary),
    photo: str(r.photo, r.profilePic, r.profilePicture, r.profilePicHighQuality, r.pictureUrl) || null,
    experience: arr(r.experience, r.experiences, r.positions).slice(0, 12).map((e) => ({
      title: str(e.position, e.title, e.jobTitle),
      company: str(e.companyName, e.company, e.subtitle, obj(e.company).name),
      duration: str(e.duration, e.caption, e.dateRange, [e.startDate, e.endDate].map((d) => (typeof d === "string" ? d : str(obj(d).text))).filter(Boolean).join(" – ")),
      description: str(e.description, arr(e.subComponents).map((s) => JSON.stringify(s)).join(" ")).slice(0, 600),
    })),
    education: arr(r.education, r.educations).slice(0, 6).map((e) => ({
      school: str(e.schoolName, e.school, e.title),
      degree: str(e.degree, e.degreeName, e.subtitle),
      field: str(e.fieldOfStudy, e.field),
    })),
    skills: arr(r.skills, r.topSkills).map((s) => (typeof s === "string" ? s : str(s.name, s.title))).filter(Boolean).slice(0, 25),
    languages: arr(r.languages).map((s) => (typeof s === "string" ? s : str(s.name, s.title))).filter(Boolean),
    volunteering: arr(r.volunteering, r.volunteerExperiences, r.volunteer).map((v) => str(v.role, v.title) + (str(v.organizationName, v.subtitle) ? ` @ ${str(v.organizationName, v.subtitle)}` : "")).filter(Boolean),
    certifications: arr(r.certifications, r.licenseAndCertificates).map((c) => str(c.title, c.name)).filter(Boolean).slice(0, 10),
    posts: [
      ...arr(r.posts, r.activity, r.updates).map((p) => str(p.text, p.content, p.title)),
      ...arr(obj(r.featured).slides).map((s) => str(s.title, s.description)),
    ]
      .filter(Boolean)
      .slice(0, 8)
      .map((t) => t.slice(0, 500)),
    follows: arr(r.interests)
      .flatMap((g) => arr(g.elements).map((e) => `${str(g.interestName)}: ${str(e.title)}${str(e.subtitle) ? ` (${str(e.subtitle).slice(0, 80)})` : ""}`))
      .slice(0, 20),
    extras: [
      ...arr(r.causes).map((c) => `cause: ${typeof c === "string" ? c : str(c.name, c.title)}`),
      ...arr(r.projects).map((p) => `project: ${str(p.title, p.name)} ${str(p.description).slice(0, 200)}`),
      ...arr(r.honorsAndAwards).map((h) => `award: ${str(h.title, h.name)}`),
      ...arr(r.organizations).map((o) => `organization: ${str(o.name, o.title)}`),
      ...arr(r.publications).map((p) => `publication: ${str(p.title, p.name)}`),
    ]
      .filter((x) => !/:\s*$/.test(x))
      .slice(0, 20),
  };
}

// ---------- Instagram ----------
export async function scrapeInstagram(url: string, username: string): Promise<{ raw: Any; data: InstagramData }> {
  const actor = process.env.APIFY_INSTAGRAM_ACTOR || "apify/instagram-profile-scraper";
  const items = await runActor(actor, { usernames: [username], directUrls: [url], resultsType: "details", resultsLimit: 12 });
  const raw = items[0];
  if (!raw || raw.error) throw new Error(`Instagram scrape failed${raw?.error ? `: ${String(raw.error)}` : ""} (does @${username} exist?)`);
  const data = normalizeInstagram(url, raw);
  if (data.isPrivate) throw new Error(`@${data.username} is a private Instagram account. Only public profiles are supported.`);
  return { raw, data };
}

export function normalizeInstagram(url: string, r: Any): InstagramData {
  return {
    url,
    username: str(r.username),
    fullName: str(r.fullName, r.full_name),
    bio: str(r.biography, r.bio),
    externalUrl: str(r.externalUrl, r.external_url),
    followers: num(r.followersCount, r.followers),
    following: num(r.followsCount, r.following),
    postsCount: num(r.postsCount, r.mediaCount),
    isPrivate: Boolean(r.private ?? r.isPrivate ?? r.is_private),
    isVerified: Boolean(r.verified ?? r.isVerified),
    category: str(r.businessCategoryName, r.category),
    profilePic: str(r.profilePicUrlHD, r.profilePicUrl) || null,
    posts: arr(r.latestPosts, r.posts).slice(0, 12).map((p) => ({
      caption: str(p.caption).slice(0, 700),
      hashtags: arr(p.hashtags).map(String).slice(0, 15),
      location: str(p.locationName),
      timestamp: str(p.timestamp),
      type: str(p.type, p.productType),
      imageUrl: str(p.displayUrl, arr(p.images)[0] as unknown) || null,
      url: str(p.url) || (p.shortCode ? `https://www.instagram.com/p/${String(p.shortCode)}/` : ""),
      likes: num(p.likesCount),
    })),
  };
}
