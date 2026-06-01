// LLM Service — pure decision engine, no Playwright code here.
// Called by scripts/linkedin-easy-apply.ts to answer form questions.

export type FieldType = 'text' | 'textarea' | 'dropdown' | 'radio' | 'checkbox';

export interface LLMRequest {
  question: string;
  fieldType: FieldType;
  options?: string[];
  profile: Record<string, unknown>;
  jobDescription?: string;
}

export type LLMResponse =
  | { selectedOption: string }
  | { answer: string }
  | { checked: boolean };

const SYSTEM_PROMPT = `You are answering job application questions on behalf of a candidate.

Rules:
- For dropdown or radio: return {"selectedOption": "<exact value from the options array>"}. NEVER invent or modify option text.
- For checkbox: return {"checked": true} or {"checked": false}.
- For text or textarea: return {"answer": "<professional, concise answer based on the candidate profile>"}.
- Return ONLY valid JSON. No explanations, no markdown, no extra text.`;

async function callGroq(userPrompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set in environment');

  const model = process.env.LLM_MODEL ?? 'llama-3.3-70b-versatile';

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 256,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Groq API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? '';
}

function validate(parsed: Record<string, unknown>, request: LLMRequest): boolean {
  if (request.fieldType === 'dropdown' || request.fieldType === 'radio') {
    const val = parsed['selectedOption'];
    if (typeof val !== 'string' || !val.trim()) return false;
    if (request.options && !request.options.includes(val)) {
      console.warn(`[AI] Validation failed: "${val}" not in options [${request.options.slice(0, 5).join(', ')}...]`);
      return false;
    }
    return true;
  }
  if (request.fieldType === 'checkbox') {
    return typeof parsed['checked'] === 'boolean';
  }
  // text / textarea
  const val = parsed['answer'];
  return typeof val === 'string' && val.trim().length > 0;
}

export async function askLLM(request: LLMRequest): Promise<LLMResponse | null> {
  const userPrompt = JSON.stringify({
    question: request.question,
    fieldType: request.fieldType,
    ...(request.options ? { options: request.options } : {}),
    ...(request.jobDescription ? { jobContext: request.jobDescription.slice(0, 600) } : {}),
    candidateProfile: request.profile,
  });

  // ── Flow log: what Playwright is sending to the LLM ──────────────────────
  const optionsSummary = request.options?.length
    ? ` | options: [${request.options.map(o => `"${o}"`).join(', ')}]`
    : '';
  console.log(`\n┌─[LLM↑ SEND] ───────────────────────────────────────────────`);
  console.log(`│  question  : "${request.question}"`);
  console.log(`│  fieldType : ${request.fieldType}${optionsSummary}`);
  console.log(`└────────────────────────────────────────────────────────────`);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await callGroq(userPrompt);
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      if (!validate(parsed, request)) {
        console.warn(`│  [LLM↓ ✗] attempt ${attempt}/2 — invalid response: ${JSON.stringify(parsed)}`);
        if (attempt < 2) continue;
        console.warn(`└─[LLM↓ FAIL] no valid answer after 2 attempts\n`);
        return null;
      }

      // ── Flow log: what the LLM returned and what Playwright will do ────
      const action = 'selectedOption' in parsed
        ? `select  → "${parsed['selectedOption']}"`
        : 'answer' in parsed
          ? `fill    → "${String(parsed['answer']).slice(0, 80)}"`
          : `check   → ${parsed['checked']}`;
      console.log(`│  [LLM↓ ✓] ${JSON.stringify(parsed)}`);
      console.log(`└─[ACTION]   ${action}\n`);

      return parsed as unknown as LLMResponse;
    } catch (err) {
      console.warn(`│  [LLM↓ ✗] attempt ${attempt}/2 — error: ${err}`);
      if (attempt >= 2) {
        console.warn(`└─[LLM↓ FAIL] ${err}\n`);
        return null;
      }
    }
  }
  return null;
}
