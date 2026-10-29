/**
 * Validation for the AI's JSON responses.
 *
 * Gemini is asked for strict JSON, but we still treat its output as untrusted
 * input: ids are sanitised, numbers clamped, dependencies filtered to existing
 * tasks, and a plan with too few real tasks is rejected with a readable error.
 */

import type { PlannedTaskInput } from './types.js';

export class AiPlanError extends Error {}

export interface ChatSummary {
  summary: string;
  decisions: string[];
  open_questions: string[];
  action_items: {
    title: string;
    description: string;
    owner_hint: string | null;
    estimated_hours: number;
    complexity: number;
  }[];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asStringArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => asString(item)).filter(Boolean))].slice(0, limit);
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function slug(value: string, fallback: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

interface RawSubtask {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  estimated_hours?: unknown;
  complexity?: unknown;
  required_skills?: unknown;
}

interface RawTask {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  phase?: unknown;
  estimated_hours?: unknown;
  complexity?: unknown;
  required_skills?: unknown;
  depends_on?: unknown;
  subtasks?: unknown;
}

export interface ParsedPlan {
  summary: string;
  assumptions: string[];
  tasks: PlannedTaskInput[];
}

function parseSubtasks(raw: unknown, parentKey: string): PlannedTaskInput[] {
  if (!Array.isArray(raw)) return [];
  const out: PlannedTaskInput[] = [];
  raw.slice(0, 8).forEach((item: RawSubtask, index) => {
    if (!item || typeof item !== 'object') return;
    const title = asString(item.title);
    if (!title) return;
    const key = asString(item.id) || `${parentKey}.${index + 1}`;
    out.push({
      key: slug(key, `${parentKey}-${index + 1}`),
      parent_key: parentKey,
      title,
      description: asString(item.description),
      estimated_hours: asNumber(item.estimated_hours, 3, 0.5, 40),
      complexity: asNumber(item.complexity, 3, 1, 5),
      required_skills: asStringArray(item.required_skills),
      depends_on: [],
      phase: '',
    });
  });
  return out;
}

/**
 * Convert the model's plan into the flat task list the planner expects.
 * Throws AiPlanError when the response cannot be used at all.
 */
export function parsePlanPayload(raw: unknown): ParsedPlan {
  if (!raw || typeof raw !== 'object') throw new AiPlanError('The AI response was not an object.');
  const payload = raw as Record<string, unknown>;
  const rawTasks = Array.isArray(payload.tasks) ? (payload.tasks as RawTask[]) : [];
  if (rawTasks.length === 0) throw new AiPlanError('The AI did not return any tasks.');

  const tasks: PlannedTaskInput[] = [];
  const topKeys = new Map<string, string>();
  const rawIds: string[] = [];
  const rawDeps: string[][] = [];

  rawTasks.slice(0, 16).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const title = asString(item.title);
    if (!title) return;

    const rawId = asString(item.id) || `T${index + 1}`;
    const key = `t${slug(rawId, String(index + 1))}`;
    const phase = asString(item.phase, 'Build') || 'Build';
    const subtasks = parseSubtasks(item.subtasks, key);

    tasks.push({
      key,
      parent_key: null,
      title,
      description: asString(item.description),
      // For a group task the planner recomputes hours from its subtasks.
      estimated_hours: asNumber(item.estimated_hours, subtasks.length > 0 ? 4 : 0, 0.5, 60),
      complexity: asNumber(item.complexity, 3, 1, 5),
      required_skills: asStringArray(item.required_skills),
      depends_on: [],
      phase,
    });
    for (const sub of subtasks) tasks.push({ ...sub, phase });

    topKeys.set(rawId.toLowerCase(), key);
    rawIds.push(key);
    rawDeps.push(asStringArray(item.depends_on).map((dep) => dep.toLowerCase()));
  });

  if (tasks.length === 0) throw new AiPlanError('The AI returned tasks without titles.');

  // Resolve dependency ids back to sanitised keys and drop anything unknown.
  const keySet = new Set(tasks.map((t) => t.key));
  let depIndex = 0;
  for (const task of tasks) {
    if (task.parent_key !== null) continue;
    const deps = rawDeps[depIndex++] ?? [];
    const resolved = deps
      .map((dep) => topKeys.get(dep) ?? (keySet.has(dep) ? dep : null))
      .filter((value): value is string => Boolean(value) && value !== task.key);
    task.depends_on = [...new Set(resolved)];
  }

  const assumptions = asStringArray(payload.assumptions, 8);
  return {
    summary: asString(payload.summary, 'AI-generated project breakdown.'),
    assumptions,
    tasks,
  };
}

export function parseChatSummary(raw: unknown): ChatSummary {
  if (!raw || typeof raw !== 'object') throw new AiPlanError('The AI response was not an object.');
  const payload = raw as Record<string, unknown>;
  const rawActions = Array.isArray(payload.action_items) ? payload.action_items : [];

  const action_items = rawActions
    .slice(0, 8)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const title = asString(record.title);
      if (!title) return null;
      return {
        title,
        description: asString(record.description),
        owner_hint: asString(record.owner_hint) || null,
        estimated_hours: asNumber(record.estimated_hours, 2, 0.5, 40),
        complexity: asNumber(record.complexity, 3, 1, 5),
      };
    })
    .filter((item): item is ChatSummary['action_items'][number] => item !== null);

  const summary = asString(payload.summary);
  if (!summary) throw new AiPlanError('The AI returned an empty summary.');

  return {
    summary,
    decisions: asStringArray(payload.decisions, 8),
    open_questions: asStringArray(payload.open_questions, 8),
    action_items,
  };
}

/** Guardrails for chat text sent to the model (prompt-injection hygiene, size). */
export function sanitiseChatBody(body: string, max = 1200): string {
  return body.replace(/\u0000/g, '').slice(0, max);
}
