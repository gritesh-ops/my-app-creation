/**
 * Google Gemini client (server-side only).
 *
 * The API key lives in GEMINI_API_KEY and never leaves the server. Responses are
 * requested as JSON, but we still parse defensively - see shared/planSchema.ts.
 */

export class AiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export interface GeminiRequest {
  apiKey: string;
  model: string;
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1].trim();
  // Sometimes the model wraps the JSON in prose before/after the fence.
  const inner = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (inner) return inner[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return trimmed;
}

function friendlyHttpError(status: number, body: GeminiResponse | null): AiError {
  const detail = body?.error?.message ?? '';
  if (status === 400) {
    return new AiError(
      detail.includes('API key')
        ? 'Gemini rejected the API key. Check GEMINI_API_KEY on the server.'
        : `Gemini rejected the request: ${detail || 'bad request'}`,
      502,
    );
  }
  if (status === 401 || status === 403) {
    return new AiError('Gemini refused the API key. Create a new key at aistudio.google.com/app/apikey and set GEMINI_API_KEY.', 502);
  }
  if (status === 404) {
    return new AiError('That Gemini model is not available for this key. Try GEMINI_MODEL=gemini-2.0-flash or gemini-2.5-flash.', 502);
  }
  if (status === 429) {
    return new AiError('Gemini free-tier rate limit reached. Wait a minute and try again, or set a billing-enabled key.', 429);
  }
  return new AiError(`Gemini request failed (HTTP ${status}). ${detail}`.trim(), 502);
}

export async function generateJson(request: GeminiRequest): Promise<unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    request.model,
  )}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: request.systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
    generationConfig: {
      temperature: request.temperature ?? 0.45,
      maxOutputTokens: request.maxOutputTokens ?? 4096,
      responseMimeType: 'application/json',
      // Gemini 2.5 models think by default; a small budget keeps latency sane
      // for an interactive "generate my plan" button.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': request.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });

      const data = (await response.json().catch(() => null)) as GeminiResponse | null;

      if (!response.ok) {
        const error = friendlyHttpError(response.status, data);
        // Retry once on transient failures only.
        if ((response.status === 429 || response.status >= 500) && attempt === 0) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }
        throw error;
      }

      if (data?.promptFeedback?.blockReason) {
        throw new AiError(
          'Gemini blocked this prompt. Remove personal data from the problem statement and try again.',
          422,
        );
      }

      const candidate = data?.candidates?.[0];
      const text = (candidate?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('')
        .trim();

      if (!text) {
        if (candidate?.finishReason === 'MAX_TOKENS') {
          throw new AiError(
            'The AI answer was cut off because it was too long. Shorten the problem statement and try again.',
            422,
          );
        }
        throw new AiError('Gemini returned an empty response. Try again.', 502);
      }

      const parsed = JSON.parse(stripCodeFence(text)) as unknown;
      return parsed;
    } catch (error) {
      if (error instanceof AiError) {
        if (attempt === 0 && error.status === 429) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new AiError('Gemini returned text that was not valid JSON. Try generating the plan again.', 502);
      }
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new AiError('Gemini took longer than 60 seconds. Try again with a shorter problem statement.', 504);
      }
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Unknown network error';
  throw new AiError(`Could not reach Gemini: ${message}`, 502);
}
