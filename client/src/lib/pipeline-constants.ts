// Shared constants for pipeline configuration forms
// Used by both job-collection.tsx and schedules.tsx

export const COUNTRIES = [
  "India", "United Arab Emirates", "United States", "United Kingdom",
  "Singapore", "Australia", "Canada", "Germany", "Netherlands",
  "Saudi Arabia", "Qatar", "Oman", "Bahrain", "Kuwait",
  "Malaysia", "Hong Kong", "Japan", "South Korea",
  "France", "Switzerland", "Ireland", "Sweden",
];

export const COUNTRY_CODE_MAP: Record<string, string> = {
  "India": "IN", "United Arab Emirates": "AE", "United States": "US",
  "United Kingdom": "GB", "Singapore": "SG", "Australia": "AU",
  "Canada": "CA", "Germany": "DE", "Netherlands": "NL",
  "Saudi Arabia": "SA", "Qatar": "QA", "Oman": "OM",
  "Bahrain": "BH", "Kuwait": "KW", "Malaysia": "MY",
  "Hong Kong": "HK", "Japan": "JP", "South Korea": "KR",
  "France": "FR", "Switzerland": "CH", "Ireland": "IE", "Sweden": "SE",
};

export const EXP_LEVELS = [
  { value: "1", label: "Internship" }, { value: "2", label: "Entry" }, { value: "3", label: "Associate" },
  { value: "4", label: "Mid-Senior" }, { value: "5", label: "Director" }, { value: "6", label: "Executive" },
];

export const WORK_TYPES = [
  { value: "1", label: "Full-time" }, { value: "2", label: "Part-time" },
  { value: "3", label: "Contract" }, { value: "4", label: "Temporary" }, { value: "6", label: "Internship" },
];

export const WORK_LOCATIONS = [
  { value: "1", label: "On-site" }, { value: "2", label: "Remote" }, { value: "3", label: "Hybrid" },
];

export const INDUSTRIES = [
  { value: "96", label: "IT Services" }, { value: "6", label: "Internet / Tech" },
  { value: "4", label: "Software Products" }, { value: "43", label: "Financial Services" },
  { value: "41", label: "Banking" }, { value: "11", label: "Management Consulting" },
  { value: "34", label: "FMCG" }, { value: "27", label: "Consumer Electronics" },
  { value: "26", label: "Automotive" }, { value: "14", label: "Healthcare" },
  { value: "69", label: "Education" }, { value: "44", label: "Real Estate" },
  { value: "8", label: "Telecom" }, { value: "86", label: "Media & Entertainment" },
  { value: "75", label: "Government" }, { value: "91", label: "Non-Profit" },
  { value: "48", label: "Insurance" }, { value: "1", label: "Retail" },
  { value: "12", label: "Pharma" }, { value: "53", label: "E-Commerce" },
];

export const TIME_OPTIONS = [
  { value: "r3600", label: "Past Hour" }, { value: "r86400", label: "Past 24 Hours" },
  { value: "r604800", label: "Past Week" }, { value: "r2592000", label: "Past Month" }, { value: "", label: "Any Time" },
];

export const LIMIT_PRESETS = [50, 100, 250, 500, 1000];

export const JOB_FAMILIES = ["Management", "Technology", "Core Engineering", "Others"] as const;

export const GOOGLE_EMP_TYPES = [
  { value: "FULLTIME", label: "Full-time" }, { value: "PARTTIME", label: "Part-time" },
  { value: "CONTRACTOR", label: "Contract" }, { value: "INTERN", label: "Intern" },
];

export interface JobRole {
  id: string;
  name: string;
  family: string;
  synonyms: string[];
}
