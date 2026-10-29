/**
 * Shared domain types.
 *
 * These types are used by the browser app AND by the Express server, so the
 * planner logic that decides who gets which task is literally the same code in
 * both places. That keeps the plan preview and the saved plan consistent.
 */

export type Experience = 'beginner' | 'intermediate' | 'advanced';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
export type PlanStatus = 'none' | 'proposed' | 'approved';
export type InviteStatus = 'owner' | 'invited' | 'accepted';

export interface MemberInput {
  id: string;
  display_name: string;
  skills: string[];
  experience: Experience;
  hours_per_week: number;
}

/** A task exactly as the AI proposed it (before balancing). */
export interface PlannedTaskInput {
  key: string;
  /** Key of the parent task when this is a subtask. */
  parent_key?: string | null;
  title: string;
  description?: string;
  estimated_hours: number;
  complexity: number;
  required_skills?: string[];
  /** Keys of tasks that must finish first. */
  depends_on?: string[];
  phase?: string;
}

export interface PlannedTask extends PlannedTaskInput {
  parent_key: string | null;
  description: string;
  required_skills: string[];
  depends_on: string[];
  phase: string;
  is_group: boolean;
  assignee_member_id: string | null;
  assignee_name: string | null;
  start_date: string | null;
  due_date: string | null;
  at_risk: boolean;
}

export interface MemberLoad {
  member_id: string;
  display_name: string;
  assigned_hours: number;
  capacity_hours: number;
  utilization: number;
  task_count: number;
  skill_match_pct: number;
  hours_by_phase: Record<string, number>;
  status: 'balanced' | 'tight' | 'over_capacity' | 'underloaded';
}

export interface ImbalanceFlag {
  member_id: string | null;
  member_name: string;
  severity: 'info' | 'warning' | 'high';
  message: string;
}

export interface TimelineEntry {
  title: string;
  description: string;
  start_date: string | null;
  due_date: string;
  kind: 'phase' | 'testing' | 'submission' | 'milestone';
}

export interface PlanResult {
  tasks: PlannedTask[];
  loads: MemberLoad[];
  flags: ImbalanceFlag[];
  timeline: TimelineEntry[];
  assumptions: string[];
  totals: {
    estimated_hours: number;
    capacity_hours: number;
    task_count: number;
    start_date: string;
    deadline: string;
    working_days: number;
  };
}

export interface ReadinessComponent {
  key: string;
  label: string;
  score: number;
  weight: number;
  contribution: number;
  detail: string;
}

export interface ReadinessResult {
  score: number;
  components: ReadinessComponent[];
  blockers: string[];
}

export interface Reminder {
  id: string;
  task_id: string | null;
  kind: 'overdue' | 'due_soon' | 'blocked' | 'unassigned' | 'no_plan';
  title: string;
  detail: string;
  due_date: string | null;
  severity: 'info' | 'warning' | 'high';
}

/* ------------------------------------------------------------------ */
/* Database row shapes (Supabase)                                      */
/* ------------------------------------------------------------------ */

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
}

export interface Project {
  id: string;
  owner_id: string;
  name: string;
  subject: string;
  problem_statement: string;
  deliverables: string[];
  deadline: string;
  start_date: string;
  status: 'planning' | 'active' | 'completed';
  plan_status: PlanStatus;
  created_at: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string | null;
  email: string;
  display_name: string;
  skills: string[];
  experience: Experience;
  hours_per_week: number;
  role: 'owner' | 'member';
  invite_status: InviteStatus;
}

export interface Task {
  id: string;
  project_id: string;
  parent_task_id: string | null;
  assignee_member_id: string | null;
  title: string;
  description: string;
  estimated_hours: number;
  complexity: number;
  required_skills: string[];
  status: TaskStatus;
  due_date: string | null;
  start_date: string | null;
  sort_order: number;
  source: 'ai' | 'manual' | 'chat';
  phase: string;
  created_at: string;
  updated_at: string;
}

export interface TaskDependency {
  task_id: string;
  depends_on_task_id: string;
}

export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  description: string;
  due_date: string;
  kind: 'milestone' | 'testing' | 'submission';
  sort_order: number;
}

export interface ChatMessage {
  id: string;
  project_id: string;
  sender_member_id: string | null;
  sender_user_id: string;
  sender_name: string;
  body: string;
  created_at: string;
}

export interface AiSuggestion {
  id: string;
  project_id: string;
  kind: 'plan' | 'chat_tasks' | 'chat_summary';
  status: 'pending' | 'applied' | 'dismissed';
  title: string;
  summary: string;
  payload: unknown;
  created_by: string | null;
  created_at: string;
}

export interface AvailabilityPoll {
  id: string;
  project_id: string;
  title: string;
  description: string;
  created_by: string;
  created_at: string;
}

export interface PollOption {
  id: string;
  poll_id: string;
  starts_at: string;
  duration_minutes: number;
}

export interface PollVote {
  poll_id: string;
  option_id: string;
  member_id: string;
  user_id: string;
  response: 'yes' | 'maybe' | 'no';
}
