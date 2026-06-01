import type { UserProfile } from './fileStore';

const GROQ_BASE = 'https://api.groq.com/openai/v1/chat/completions';

function getModel() {
  return process.env.LLM_MODEL ?? 'llama-3.3-70b-versatile';
}

async function callGroq(system: string, user: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  const res = await fetch(GROQ_BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: getModel(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.1,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Groq error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? '{}';
}

export async function extractProfile(resumeText: string): Promise<Partial<UserProfile>> {
  const system = `Extract a structured candidate profile from the resume text.
Return ONLY valid JSON matching this exact shape:
{
  "name": "",
  "firstName": "",
  "lastName": "",
  "email": "",
  "phone": "",
  "phoneCountryCode": "",
  "city": "",
  "currentLocation": "",
  "linkedinUrl": "",
  "githubUrl": "",
  "education": [{"degree":"","institution":"","year":0}],
  "skills": [],
  "experience": {},
  "yearsOfTotalExperience": 0,
  "projects": [{"name":"","description":"","technologies":[]}],
  "certifications": [],
  "relocation": true,
  "requiresSponsorship": false,
  "workAuthorization": true,
  "noticePeriodDays": 0
}
For phoneCountryCode: infer from phone number format or city (e.g. "+91" for India, "+1" for USA). Include country name and code, e.g. "India (+91)".
Leave other fields empty/null if not found. Do not invent information.`;

  const raw = await callGroq(system, `Resume:\n${resumeText.slice(0, 6000)}`);
  try {
    return JSON.parse(raw) as Partial<UserProfile>;
  } catch {
    return {};
  }
}

export async function scoreJob(
  job: { title: string; company: string },
  profile: Partial<UserProfile>
): Promise<number> {
  const system = `You are a job-match evaluator. Given a candidate profile and a job, return a match score 0-100.
Return ONLY valid JSON: {"score": <number 0-100>}
Higher score = better match for the candidate's skills and experience level.`;

  const user = JSON.stringify({
    job: { title: job.title, company: job.company },
    candidate: {
      skills: profile.skills ?? [],
      experience: profile.experience ?? {},
      yearsOfTotalExperience: profile.yearsOfTotalExperience ?? 0,
    },
  });

  try {
    const raw = await callGroq(system, user);
    const parsed = JSON.parse(raw) as { score?: number };
    return typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50;
  } catch {
    return 50;
  }
}
