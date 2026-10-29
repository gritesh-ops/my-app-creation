/**
 * Server entry point.
 *
 * Binds to 0.0.0.0 so the container is reachable from outside (binding to
 * 127.0.0.1 is the classic cause of a "build succeeded but 502" deployment).
 */

import 'dotenv/config';
import { createApp } from './app.js';
import { aiConfigured, loadConfig, supabaseConfigured } from './config.js';

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, '0.0.0.0', () => {
  console.log(`[teampilot] listening on http://0.0.0.0:${config.port}`);
  console.log(`[teampilot] supabase configured: ${supabaseConfigured(config) ? 'yes' : 'NO'}`);
  console.log(`[teampilot] gemini configured:   ${aiConfigured(config) ? `yes (${config.geminiModel})` : 'NO'}`);
  if (!supabaseConfigured(config)) {
    console.warn('[teampilot] Set SUPABASE_URL and SUPABASE_ANON_KEY to enable sign-in and data.');
  }
  if (!aiConfigured(config)) {
    console.warn('[teampilot] Set GEMINI_API_KEY to enable AI planning and chat summaries.');
  }
});
