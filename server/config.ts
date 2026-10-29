/**
 * Server configuration.
 *
 * Everything here is read from the process environment only. None of these
 * values are ever sent to the browser except SUPABASE_URL / SUPABASE_ANON_KEY,
 * which are public by design (Row Level Security is what protects the data).
 * GEMINI_API_KEY must never be exposed.
 */

export interface ServerConfig {
  port: number;
  supabaseUrl: string;
  supabaseAnonKey: string;
  geminiApiKey: string;
  geminiModel: string;
}

function firstDefined(...values: (string | undefined)[]): string {
  for (const value of values) {
    if (value && value.trim() && !value.includes('YOUR-')) return value.trim();
  }
  return '';
}

export function loadConfig(): ServerConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    // SUPABASE_URL is preferred, but we accept VITE_* so a single .env works.
    supabaseUrl: firstDefined(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL),
    supabaseAnonKey: firstDefined(process.env.SUPABASE_ANON_KEY, process.env.VITE_SUPABASE_ANON_KEY),
    geminiApiKey: firstDefined(process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY),
    geminiModel: firstDefined(process.env.GEMINI_MODEL) || 'gemini-2.5-flash',
  };
}

export function supabaseConfigured(config: ServerConfig): boolean {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

export function aiConfigured(config: ServerConfig): boolean {
  return Boolean(config.geminiApiKey);
}
