/**
 * Express app for TeamPilot AI.
 *
 * Endpoints
 *   GET  /api/health          - liveness + which integrations are configured
 *   GET  /api/config          - public Supabase URL/anon key for the browser
 *   POST /api/ai/plan         - Gemini task breakdown + deterministic balancing
 *   POST /api/ai/chat-summary - Gemini summary of the group chat + suggested tasks
 *
 * Every AI endpoint verifies the caller's Supabase JWT and then queries with
 * that same token, so Row Level Security decides what is readable.
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { aiConfigured, supabaseConfigured, type ServerConfig } from './config.js';
import { AiError, generateJson } from './gemini.js';
import { buildChatPrompt, buildPlanPrompt, CHAT_SYSTEM_INSTRUCTION, PLAN_SYSTEM_INSTRUCTION } from './prompts.js';
import { UnauthorizedError, userClient, verifyToken, type AuthedUser } from './supabase.js';
import { AiPlanError, parseChatSummary, parsePlanPayload } from '../src/shared/planSchema.js';
import { balanceWorkload } from '../src/shared/planner.js';
import { todayISO } from '../src/shared/dates.js';
import type { MemberInput, PlannedTask, Project, ProjectMember } from '../src/shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ApiRequest extends Request {
  user?: AuthedUser;
  db?: SupabaseClient;
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readProjectId(body: unknown): string {
  const value = (body as { project_id?: unknown } | null)?.project_id;
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ApiError('A valid project_id is required.');
  }
  return value;
}

function toMemberInput(member: ProjectMember): MemberInput {
  return {
    id: member.id,
    display_name: member.display_name,
    skills: Array.isArray(member.skills) ? member.skills : [],
    experience: member.experience,
    hours_per_week: Number(member.hours_per_week) || 0,
  };
}

/** Load a project + its members, enforcing that the caller has joined it. */
async function loadProjectContext(
  db: SupabaseClient,
  projectId: string,
  user: AuthedUser,
): Promise<{ project: Project; members: ProjectMember[]; me: ProjectMember }> {
  const { data: project, error } = await db.from('projects').select('*').eq('id', projectId).maybeSingle();
  if (error) throw new ApiError(`Could not load the project: ${error.message}`, 500);
  if (!project) throw new ApiError('Project not found. It may have been deleted, or you are not a member.', 404);

  const { data: members, error: membersError } = await db
    .from('project_members')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (membersError) throw new ApiError(`Could not load team members: ${membersError.message}`, 500);

  const list = (members ?? []) as ProjectMember[];
  const me = list.find((member) => member.user_id === user.id);
  if (!me) throw new ApiError('Join this project before using the AI planner.', 403);
  if (me.invite_status === 'invited') {
    throw new ApiError('Accept the project invitation before using the AI planner.', 403);
  }

  return { project: project as Project, members: list, me };
}

function toAiPayload(plan: ReturnType<typeof balanceWorkload>, summary: string) {
  const tasks = plan.tasks.map((task: PlannedTask, index) => ({
    key: task.key,
    parent_key: task.parent_key,
    title: task.title,
    description: task.description,
    estimated_hours: task.estimated_hours,
    complexity: task.complexity,
    required_skills: task.required_skills,
    depends_on: task.depends_on,
    phase: task.phase,
    assignee_member_id: task.assignee_member_id,
    start_date: task.start_date,
    due_date: task.due_date,
    sort_order: index,
  }));

  return {
    summary,
    assumptions: plan.assumptions,
    totals: plan.totals,
    loads: plan.loads,
    flags: plan.flags,
    tasks,
    timeline: plan.timeline,
  };
}

export function createApp(config: ServerConfig): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  /* ------------------------------ public ------------------------------ */

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      supabase_configured: supabaseConfigured(config),
      ai_configured: aiConfigured(config),
      model: config.geminiModel,
    });
  });

  app.get('/api/config', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      supabase_url: config.supabaseUrl,
      supabase_anon_key: config.supabaseAnonKey,
      ai_configured: aiConfigured(config),
    });
  });

  /* ------------------------------ auth ------------------------------ */

  const authenticate = async (req: ApiRequest, _res: Response, next: NextFunction) => {
    try {
      if (!supabaseConfigured(config)) {
        throw new ApiError(
          'Supabase is not configured on the server. Set SUPABASE_URL and SUPABASE_ANON_KEY.',
          503,
        );
      }
      const header = req.header('authorization') ?? '';
      const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
      if (!token) throw new UnauthorizedError('Sign in to continue.');
      req.user = await verifyToken(config, token);
      req.db = userClient(config, token);
      next();
    } catch (error) {
      next(error);
    }
  };

  /* ------------------------------ AI ------------------------------ */

  app.post('/api/ai/plan', authenticate, async (req: ApiRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = readProjectId(req.body);
      const { project, members, me } = await loadProjectContext(req.db!, projectId, req.user!);

      if (members.length === 0) {
        throw new ApiError('Add at least one team member before generating a plan.');
      }
      if (members.every((member) => Number(member.hours_per_week) <= 0)) {
        throw new ApiError('Give at least one member some available hours per week so work can be balanced.');
      }
      if (!aiConfigured(config)) {
        throw new ApiError(
          'The AI planner is not configured yet. Set GEMINI_API_KEY in the server environment (free key at aistudio.google.com/app/apikey), then restart the app.',
          503,
        );
      }
      if (project.plan_status === 'approved' && me.role !== 'owner') {
        throw new ApiError('The plan is already approved. Ask the project owner to regenerate it.', 409);
      }

      const prompt = buildPlanPrompt({
        project: {
          name: project.name,
          subject: project.subject,
          problem_statement: project.problem_statement,
          deliverables: Array.isArray(project.deliverables) ? project.deliverables : [],
          start_date: project.start_date,
          deadline: project.deadline,
        },
        members: members.map(toMemberInput),
        today: todayISO(),
      });

      const raw = await generateJson({
        apiKey: config.geminiApiKey,
        model: config.geminiModel,
        systemInstruction: PLAN_SYSTEM_INSTRUCTION,
        prompt,
        temperature: 0.4,
      });

      const parsed = parsePlanPayload(raw);
      const plan = balanceWorkload(parsed.tasks, members.map(toMemberInput), {
        start_date: project.start_date,
        deadline: project.deadline,
      });

      const summary = parsed.summary;
      const payload = toAiPayload(plan, summary);
      payload.assumptions = [...parsed.assumptions, ...plan.assumptions];

      // Persist the proposal so approval is an explicit, auditable step.
      const { data: suggestion, error: insertError } = await req
        .db!.from('ai_suggestions')
        .insert({
          project_id: projectId,
          kind: 'plan',
          status: 'pending',
          title: `Plan for ${project.name}`,
          summary,
          payload,
          created_by: req.user!.id,
        })
        .select('id, created_at')
        .single();

      if (insertError) throw new ApiError(`Could not save the proposal: ${insertError.message}`, 500);

      res.json({
        suggestion_id: suggestion.id,
        created_at: suggestion.created_at,
        summary,
        plan,
        assumptions: payload.assumptions,
        ai_configured: true,
        model: config.geminiModel,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/api/ai/chat-summary',
    authenticate,
    async (req: ApiRequest, res: Response, next: NextFunction) => {
      try {
        const projectId = readProjectId(req.body);
        const { project, members } = await loadProjectContext(req.db!, projectId, req.user!);

        if (!aiConfigured(config)) {
          throw new ApiError(
            'AI summaries are not configured yet. Set GEMINI_API_KEY in the server environment, then restart the app.',
            503,
          );
        }

        const { data: messages, error: messagesError } = await req.db!
          .from('messages')
          .select('sender_name, body, created_at')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(150);
        if (messagesError) throw new ApiError(`Could not read the chat: ${messagesError.message}`, 500);

        const transcript = (messages ?? []) as { sender_name: string; body: string; created_at: string }[];
        if (transcript.length === 0) {
          throw new ApiError('There are no chat messages to summarise yet.');
        }

        const { data: tasks } = await req.db!
          .from('tasks')
          .select('title, status, assignee_member_id')
          .eq('project_id', projectId)
          .order('sort_order', { ascending: true })
          .limit(200);

        const nameById = new Map(members.map((member) => [member.id, member.display_name]));

        const prompt = buildChatPrompt({
          projectName: project.name,
          deadline: project.deadline,
          today: todayISO(),
          members: members.map((member) => ({ display_name: member.display_name })),
          existingTasks: ((tasks ?? []) as { title: string; status: string; assignee_member_id: string | null }[]).map(
            (task) => ({
              title: task.title,
              status: task.status,
              assignee: task.assignee_member_id ? nameById.get(task.assignee_member_id) ?? null : null,
            }),
          ),
          messages: [...transcript].reverse(),
        });

        const raw = await generateJson({
          apiKey: config.geminiApiKey,
          model: config.geminiModel,
          systemInstruction: CHAT_SYSTEM_INSTRUCTION,
          prompt,
          temperature: 0.3,
        });

        const summary = parseChatSummary(raw);

        const { data: suggestion, error: insertError } = await req
          .db!.from('ai_suggestions')
          .insert({
            project_id: projectId,
            kind: 'chat_summary',
            status: 'pending',
            title: 'Chat summary',
            summary: summary.summary,
            payload: summary,
            created_by: req.user!.id,
          })
          .select('id, created_at')
          .single();
        if (insertError) throw new ApiError(`Could not save the summary: ${insertError.message}`, 500);

        res.json({ suggestion_id: suggestion.id, created_at: suggestion.created_at, ...summary });
      } catch (error) {
        next(error);
      }
    },
  );

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Unknown API endpoint.' });
  });

  /* ------------------------------ static ------------------------------ */

  const distDir = path.resolve(__dirname, '../dist');
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(distDir, 'index.html'), (error) => {
      if (error) {
        res
          .status(503)
          .type('text/plain')
          .send('The frontend build is missing. Run "npm run build" before starting the server.');
      }
    });
  });

  /* ------------------------------ errors ------------------------------ */

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError || error instanceof AiError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof UnauthorizedError) {
      res.status(401).json({ error: error.message });
      return;
    }
    if (error instanceof AiPlanError) {
      res.status(502).json({ error: `The AI response was unusable: ${error.message} Try generating again.` });
      return;
    }
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    console.error('[teampilot] unhandled error:', error);
    res.status(500).json({ error: message });
  });

  return app;
}
