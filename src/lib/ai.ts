const GROQ_API_URL = process.env.GROQ_API_URL;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// llama-3.1-8b-instant: fast + comfortably inside Groq's free tier for a
// short summarize-and-tag task. Swap here if Groq ever deprecates it.
const MODEL = 'llama-3.1-8b-instant';

export interface TriageResult {
    summary: string;
    tag: string;
}

// Calls Groq's free-tier chat completions API to summarize and tag a
// /report's free-text body. Designed to NEVER throw past this boundary in
// normal use -- a missing key, network failure, timeout, or malformed model
// output all just resolve to `null`, so the caller can fall back to the
// rule-based tag/reply without the interaction ever being at risk.
export async function triageReportText(text: string): Promise<TriageResult | null> {
    if (!GROQ_API_KEY || !text?.trim()) return null;

    const controller = new AbortController();
    // Keep this well under Vercel's function-duration ceiling -- after() still
    // consumes execution time against that limit, this call just doesn't
    // block Discord's own 3-second ack.
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        const res = await fetch(GROQ_API_URL as string, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: MODEL,
                temperature: 0.2,
                max_completion_tokens: 150,
                messages: [
                    {
                        role: 'system',
                        content:
                            'You triage short user-submitted reports for a Discord bot. ' +
                            'Given the report text, respond with ONLY a JSON object, no ' +
                            'other text, no markdown fences, in exactly this shape: ' +
                            '{"summary": "one concise sentence, under 20 words", ' +
                            '"tag": "a single lowercase word or short-hyphenated-phrase ' +
                            'categorizing the report, e.g. bug, feature-request, spam, ' +
                            'question, abuse, other"}',
                    },
                    { role: 'user', content: text.slice(0, 2000) },
                ],
            }),
            signal: controller.signal,
        });

        if (!res.ok) return null;

        const data = await res.json();
        const raw: string | undefined = data?.choices?.[0]?.message?.content;
        if (!raw) return null;

        const parsed = JSON.parse(raw.trim());
        if (typeof parsed?.summary !== 'string' || typeof parsed?.tag !== 'string') return null;

        return {
            summary: parsed.summary.slice(0, 300),
            tag: parsed.tag.trim().toLowerCase().slice(0, 50) || 'other',
        };
    } catch {
        // Covers: abort/timeout, network error, non-JSON model output. All
        // treated identically -- no AI triage this time, caller falls back.
        return null;
    } finally {
        clearTimeout(timeout);
    }
}