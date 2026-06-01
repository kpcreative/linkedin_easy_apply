import * as fs from 'fs';
import * as path from 'path';

// data/ lives one level above web/ in the monorepo root
const DATA_DIR = path.join(process.cwd(), '..', 'data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface UserProfile {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  phoneCountryCode: string;
  city: string;
  currentLocation: string;
  linkedinUrl: string;
  githubUrl: string;
  education: Array<{ degree: string; institution: string; year: number }>;
  skills: string[];
  experience: Record<string, number>;
  yearsOfTotalExperience: number;
  skillExperience?: Record<string, number>;
  relocation: boolean;
  requiresSponsorship: boolean;
  workAuthorization: boolean;
  noticePeriodDays: number;
  desiredSalary: string;
  currentCTC: string;
  expectedCTC: string;
  genderIdentity: string;
  veteranStatus: string;
  disabilityStatus: string;
  projects: Array<{ name: string; description: string; technologies: string[] }>;
  certifications: string[];
}

export interface UserPrefs {
  keywords: string;
  location: string;
  workMode: string[];
  minExperience: number;
  maxExperience: number;
  maxApplications: number;
  easyApplyOnly: boolean;
  requiresSponsorship: boolean;
  minSalary: number;
  maxSalary: number;
  jobTitles: string[];
  experienceLevel: 'fresher' | 'experienced';
}

export interface ApplicationRecord {
  id: string;
  title: string;
  company: string;
  url: string;
  appliedAt: string | null;
  status: 'submitted' | 'skipped' | 'error' | 'already_applied';
  errorDetail: string | null;
  missingFields: string[];
}

export function readProfile(): Partial<UserProfile> {
  const p = path.join(DATA_DIR, 'profile.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<UserProfile>; }
  catch { return {}; }
}

export function writeProfile(profile: Partial<UserProfile>): void {
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, 'profile.json'), JSON.stringify(profile, null, 2), 'utf-8');
}

export function readPrefs(): Partial<UserPrefs> {
  const p = path.join(DATA_DIR, 'prefs.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<UserPrefs>; }
  catch { return {}; }
}

export function writePrefs(prefs: Partial<UserPrefs>): void {
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, 'prefs.json'), JSON.stringify(prefs, null, 2), 'utf-8');
}

export function readApplications(): ApplicationRecord[] {
  const p = path.join(DATA_DIR, 'linkedin-applications.json');
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as ApplicationRecord[]; }
  catch { return []; }
}

export function readAutomationLog(lines = 80): string[] {
  const p = path.join(DATA_DIR, 'automation.log');
  if (!fs.existsSync(p)) return [];
  try {
    const content = fs.readFileSync(p, 'utf-8');
    return content.split('\n').filter(Boolean).slice(-lines);
  } catch { return []; }
}

export function readAutomationPid(): number | null {
  const p = path.join(DATA_DIR, 'automation.pid');
  if (!fs.existsSync(p)) return null;
  try { return parseInt(fs.readFileSync(p, 'utf-8').trim(), 10); }
  catch { return null; }
}

export function writeAutomationPid(pid: number): void {
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, 'automation.pid'), String(pid), 'utf-8');
}

export function clearAutomationPid(): void {
  const p = path.join(DATA_DIR, 'automation.pid');
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
