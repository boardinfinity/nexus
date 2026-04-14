import { randomInt } from "crypto";
import { supabase } from "./supabase";

export function normalizeText(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
}

const ARABIC_EMPLOYMENT_MAP: Record<string, string> = {
  "دوام كامل": "full_time",
  "دوام جزئي": "part_time",
  "عقد": "contract",
  "تدريب": "internship",
  "FULLTIME": "full_time",
  "PARTTIME": "part_time",
  "CONTRACTOR": "contract",
  "INTERN": "internship",
};

export function mapEmploymentTypeExtended(raw: string | null): string | null {
  if (!raw) return null;
  if (ARABIC_EMPLOYMENT_MAP[raw]) return ARABIC_EMPLOYMENT_MAP[raw];
  if (ARABIC_EMPLOYMENT_MAP[raw.toUpperCase()]) return ARABIC_EMPLOYMENT_MAP[raw.toUpperCase()];
  const lower = raw.toLowerCase();
  if (lower.includes("full")) return "full_time";
  if (lower.includes("part")) return "part_time";
  if (lower.includes("intern")) return "internship";
  if (lower.includes("contract")) return "contract";
  if (lower.includes("temp")) return "temporary";
  return lower || "other";
}

export function mapEmploymentType(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("full")) return "full_time";
  if (lower.includes("part")) return "part_time";
  if (lower.includes("intern")) return "internship";
  if (lower.includes("contract")) return "contract";
  if (lower.includes("temp")) return "temporary";
  return "other";
}

export function mapSeniority(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("intern")) return "internship";
  if (lower.includes("entry")) return "entry_level";
  if (lower.includes("associate")) return "associate";
  if (lower.includes("mid") || lower.includes("senior")) return "mid_senior";
  if (lower.includes("director")) return "director";
  if (lower.includes("vp") || lower.includes("vice")) return "vp";
  if (lower.includes("cto") || lower.includes("ceo") || lower.includes("chief") || lower.includes("c-suite")) return "c_suite";
  return "other";
}

// O*NET Job Zone to seniority mapping (from Google Jobs Apify actor)
// Zone 1: Little or No Preparation, Zone 2: Some Preparation, Zone 3: Medium Preparation
// Zone 4: Considerable Preparation, Zone 5: Extensive Preparation
export function mapOnetJobZone(zone: string | number | null): string | null {
  if (!zone) return null;
  const z = parseInt(String(zone));
  if (z === 1) return "internship";
  if (z === 2) return "entry_level";
  if (z === 3) return "associate";
  if (z === 4) return "mid_senior";
  if (z === 5) return "director";
  return null;
}

const SENIORITY_MAP: Record<string, string> = {
  "associate": "associate",
  "entry level": "entry_level",
  "mid-senior level": "mid_senior",
  "director": "director",
  "executive": "executive",
  "internship": "internship",
};

export function mapSeniorityFromClay(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  return SENIORITY_MAP[lower] || "unknown";
}

export function parseDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null;
  }
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*(pvt\.?\s*ltd\.?|ltd\.?|inc\.?|llc|corp\.?|corporation|private\s+limited|limited|india)\s*$/gi, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function upsertCompanyByName(name: string, website?: string | null, logoUrl?: string | null): Promise<string | null> {
  const { data: existing } = await supabase
    .from("companies")
    .select("id")
    .eq("name", name)
    .maybeSingle();
  if (existing) return existing.id;

  const normalized = normalizeCompanyName(name);
  if (normalized) {
    const { data: normalizedMatch } = await supabase
      .from("companies")
      .select("id")
      .eq("name_normalized", normalized)
      .limit(1)
      .maybeSingle();
    if (normalizedMatch) return normalizedMatch.id;
  }

  const domain = parseDomain(website ?? null);
  const insertData: Record<string, any> = {
    name,
    name_normalized: normalized || null,
    enrichment_status: "pending",
  };
  if (domain) insertData.domain = domain;
  if (website) insertData.website = website;
  if (logoUrl) insertData.logo_url = logoUrl;

  const { data: newCompany } = await supabase
    .from("companies")
    .insert(insertData)
    .select("id")
    .maybeSingle();
  return newCompany?.id || null;
}

export function findEducationEntry(education: any[], universitySlug: string): any | null {
  if (!Array.isArray(education) || !education.length) return null;
  const slugParts = universitySlug.toLowerCase().split("-").filter(Boolean);
  for (const edu of education) {
    const schoolName = (edu.schoolName || edu.school || edu.institution || "").toLowerCase();
    const matchCount = slugParts.filter(part => schoolName.includes(part)).length;
    if (matchCount >= Math.ceil(slugParts.length * 0.6)) return edu;
  }
  return education[0];
}

export function formatUniversityName(slug: string): string {
  return slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function mapPersonSeniority(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase();
  if (lower.includes("intern")) return "intern";
  if (lower.includes("entry") || lower.includes("junior")) return "entry";
  if (lower.includes("associate")) return "associate";
  if (lower.includes("senior") || lower.includes("mid") || lower.includes("lead")) return "mid_senior";
  if (lower.includes("director")) return "director";
  if (lower.includes("vp") || lower.includes("vice")) return "vp";
  if (lower.includes("chief") || lower.includes("cto") || lower.includes("ceo") || lower.includes("cfo")) return "c_suite";
  return "unknown";
}

export function mapPersonFunction(raw: string | null | undefined): string {
  if (!raw) return "other";
  const lower = raw.toLowerCase();
  if (lower.includes("engineer") || lower.includes("develop") || lower.includes("tech")) return "engineering";
  if (lower.includes("sale")) return "sales";
  if (lower.includes("market")) return "marketing";
  if (lower.includes("hr") || lower.includes("human") || lower.includes("recruit") || lower.includes("talent")) return "hr";
  if (lower.includes("financ") || lower.includes("account")) return "finance";
  if (lower.includes("operat")) return "operations";
  if (lower.includes("product")) return "product";
  if (lower.includes("design")) return "design";
  if (lower.includes("data") || lower.includes("analyt")) return "data";
  if (lower.includes("legal")) return "legal";
  if (lower.includes("consult")) return "consulting";
  if (lower.includes("educ") || lower.includes("teach")) return "education";
  if (lower.includes("health") || lower.includes("medical")) return "healthcare";
  return "other";
}

export function generateSecureOtp(length: number = 6): string {
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += randomInt(0, 10).toString();
  }
  return otp;
}

export function chunkText(text: string, maxChars: number = 80000): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n\n", end);
      if (lastNewline > start + maxChars * 0.5) end = lastNewline;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

export function chunkTextForCatalog(text: string, maxChars: number = 20000): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n\n", end);
      if (lastNewline > start + maxChars * 0.5) end = lastNewline;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

export function generatePeopleSearchStub(params: any, count: number): any[] {
  const titles = ["Software Engineer", "Product Manager", "Data Scientist", "Marketing Manager", "Sales Director"];
  const companies = ["Google", "Microsoft", "Amazon", "Meta", "Apple", "Flipkart", "Infosys", "TCS"];
  const cities = ["Mumbai", "Bangalore", "Delhi", "Hyderabad", "Pune", "Chennai"];
  const seniorities = ["junior", "mid", "senior", "lead", "director"];
  const departments = ["Engineering", "Sales", "Marketing", "Product", "HR", "Data"];
  const firstNames = ["Rahul", "Priya", "Amit", "Sneha", "Vikram", "Ananya", "Karan", "Neha", "Arjun", "Divya"];
  const lastNames = ["Sharma", "Patel", "Gupta", "Singh", "Kumar", "Reddy", "Jain", "Verma", "Mehta", "Das"];

  const results: any[] = [];
  const usedCount = Math.min(count, 10);
  for (let i = 0; i < usedCount; i++) {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[i % lastNames.length];
    results.push({
      full_name: `${firstName} ${lastName}`,
      first_name: firstName,
      last_name: lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
      linkedin_url: `https://linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}-stub`,
      title: params.job_title || titles[i % titles.length],
      company_name: params.company || companies[i % companies.length],
      company_domain: null,
      city: params.location || cities[i % cities.length],
      country: "India",
      seniority: params.seniority || seniorities[i % seniorities.length],
      department: departments[i % departments.length],
      _stub: true,
    });
  }
  return results;
}
