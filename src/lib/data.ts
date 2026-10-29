/**
 * Shared helpers for reading and writing project data through Supabase.
 *
 * Everything here runs as the signed-in student, so Row Level Security (not the
 * UI) decides what is visible.
 */

import { supabase } from './supabase.js';
import type { Milestone, PlanResult, Project, ProjectMember, Task } from '../shared/types.js';

export function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message ? `${fallback} (${error.message})` : fallback);
}

export interface ProjectSummary extends Project {
  task_count: number;
  done_count: number;
  overdue_count: number;
  member_count: number;
}

/** Projects the current user owns or has accepted, with light-weight counters. */
export async function loadProjectSummaries(): Promise<ProjectSummary[]> {
  const { data: projects, error } = await supabase()
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) fail(error, 'Could not load your projects');

  const list = (projects ?? []) as Project[];
  if (list.length === 0) return [];

  const ids = list.map((project) => project.id);
  const [{ data: tasks, error: taskError }, { data: members, error: memberError }] = await Promise.all([
    supabase().from('tasks').select('id, project_id, status, due_date').in('project_id', ids),
    supabase().from('project_members').select('id, project_id').in('project_id', ids),
  ]);
  if (taskError) fail(taskError, 'Could not load task counts');
  if (memberError) fail(memberError, 'Could not load team sizes');

  const today = new Date().toISOString().slice(0, 10);
  return list.map((project) => {
    const projectTasks = (tasks ?? []).filter((task) => task.project_id === project.id);
    return {
      ...project,
      task_count: projectTasks.length,
      done_count: projectTasks.filter((task) => task.status === 'done').length,
      overdue_count: projectTasks.filter((task) => task.status !== 'done' && task.due_date && task.due_date < today)
        .length,
      member_count: (members ?? []).filter((member) => member.project_id === project.id).length,
    };
  });
}

export interface ProjectBundle {
  project: Project;
  members: ProjectMember[];
  tasks: Task[];
  milestones: Milestone[];
  me: ProjectMember | null;
}

export async function loadProjectBundle(projectId: string): Promise<ProjectBundle> {
  const { data: project, error } = await supabase().from('projects').select('*').eq('id', projectId).maybeSingle();
  if (error) fail(error, 'Could not load this project');
  if (!project) throw new Error('This project does not exist, or you are not a member of it.');

  const [{ data: members, error: memberError }, { data: tasks, error: taskError }, { data: milestones, error: milestoneError }] =
    await Promise.all([
      supabase().from('project_members').select('*').eq('project_id', projectId).order('created_at'),
      supabase().from('tasks').select('*').eq('project_id', projectId).order('sort_order'),
      supabase().from('milestones').select('*').eq('project_id', projectId).order('due_date'),
    ]);
  if (memberError) fail(memberError, 'Could not load team members');
  if (taskError) fail(taskError, 'Could not load tasks');
  if (milestoneError) fail(milestoneError, 'Could not load milestones');

  const memberList = (members ?? []) as ProjectMember[];
  const { data: auth } = await supabase().auth.getUser();
  const me = memberList.find((member) => member.user_id === auth.user?.id) ?? null;

  return {
    project: project as Project,
    members: memberList,
    tasks: (tasks ?? []) as Task[],
    milestones: (milestones ?? []) as Milestone[],
    me,
  };
}

/** Save the AI-balanced plan through the atomic apply_plan RPC. */
export async function applyPlanSuggestion(suggestionId: string): Promise<void> {
  const { error } = await supabase().rpc('apply_plan', { p_suggestion_id: suggestionId });
  if (error) fail(error, 'Could not save the approved plan');
}

export async function dismissSuggestion(suggestionId: string): Promise<void> {
  const { error } = await supabase()
    .from('ai_suggestions')
    .update({ status: 'dismissed' })
    .eq('id', suggestionId);
  if (error) fail(error, 'Could not dismiss the suggestion');
}

export function totalTaskHours(tasks: Pick<Task, 'estimated_hours'>[]): number {
  return tasks.reduce((sum, task) => sum + Number(task.estimated_hours || 0), 0);
}

export function planTotals(plan: PlanResult) {
  return {
    hours: plan.totals.estimated_hours,
    capacity: plan.totals.capacity_hours,
    tasks: plan.totals.task_count,
    days: plan.totals.working_days,
  };
}
