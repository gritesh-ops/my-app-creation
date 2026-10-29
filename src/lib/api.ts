/**
 * Calls to our own Express API (never to Gemini directly).
 *
 * The AI key stays on the server. The browser only sends its Supabase access
 * token, which the server verifies before doing anything.
 */

import type { PlanResult } from '../shared/types.js';
import { supabase } from './supabase.js';

export class ApiRequestError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiRequestError('Your session expired. Please sign in again.', 401);

  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError('The server is unreachable. Check that the app is running and try again.');
  }

  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new ApiRequestError(payload?.error ?? `Request failed (HTTP ${response.status}).`, response.status);
  }
  return payload as T;
}

export interface PlanResponse {
  suggestion_id: string;
  created_at: string;
  summary: string;
  plan: PlanResult;
  assumptions: string[];
  model: string;
}

export interface ChatActionItem {
  title: string;
  description: string;
  owner_hint: string | null;
  estimated_hours: number;
  complexity: number;
}

export interface ChatSummaryResponse {
  suggestion_id: string;
  created_at: string;
  summary: string;
  decisions: string[];
  open_questions: string[];
  action_items: ChatActionItem[];
}

export function requestPlan(projectId: string): Promise<PlanResponse> {
  return post<PlanResponse>('/api/ai/plan', { project_id: projectId });
}

export function requestChatSummary(projectId: string): Promise<ChatSummaryResponse> {
  return post<ChatSummaryResponse>('/api/ai/chat-summary', { project_id: projectId });
}
