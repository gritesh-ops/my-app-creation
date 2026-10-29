/**
 * Transparent readiness score.
 *
 * Every point is explainable: each component returns its own 0-100 score, its
 * weight and a human-readable detail line, and the dashboard renders all of
 * them. No magic numbers are hidden from the student.
 */

import { businessDaysBetween, daysBetween, parseDate, todayISO, toISODate } from './dates.js';
import type {
  Milestone,
  PlanStatus,
  ReadinessComponent,
  ReadinessResult,
  Reminder,
  Task,
} from './types.js';

export interface ReadinessInput {
  tasks: Pick<Task, 'id' | 'title' | 'estimated_hours' | 'status' | 'due_date' | 'assignee_member_id'>[];
  milestones: Pick<Milestone, 'title' | 'kind' | 'due_date'>[];
  plan_status: PlanStatus;
  deadline: string;
  today?: string;
  /** Sum of members' hours_per_week, used to see whether the remaining work fits. */
  weekly_capacity_hours: number;
  member_ids?: string[];
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const today = input.today ?? todayISO();
  const tasks = input.tasks ?? [];
  const workingDaysLeft = businessDaysBetween(today, input.deadline);
  const daysLeft = daysBetween(today, input.deadline);

  const totalHours = tasks.reduce((sum, t) => sum + Number(t.estimated_hours || 0), 0);
  const doneHours = tasks
    .filter((t) => t.status === 'done')
    .reduce((sum, t) => sum + Number(t.estimated_hours || 0), 0);
  const remainingHours = Math.max(0, totalHours - doneHours);

  const open = tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.due_date && t.due_date < today);
  const blocked = open.filter((t) => t.status === 'blocked');
  const unassigned = open.filter((t) => !t.assignee_member_id);

  // 1) Work completed, measured in HOURS (not task counts, which lie).
  const progressScore = totalHours > 0 ? (doneHours / totalHours) * 100 : 0;

  // 2) Deadlines: how much of the open work is already late.
  const deadlineScore = open.length > 0 ? 100 - (overdue.length / open.length) * 100 : totalHours > 0 ? 100 : 0;

  // 3) Blocked work.
  const blockedScore = open.length > 0 ? 100 - (blocked.length / open.length) * 100 : totalHours > 0 ? 100 : 0;

  // 4) Time buffer: can the remaining hours fit in the remaining team capacity?
  const remainingCapacity = (input.weekly_capacity_hours * Math.max(workingDaysLeft, 0)) / 5;
  const bufferScore =
    remainingHours === 0
      ? totalHours > 0
        ? 100
        : 0
      : remainingCapacity <= 0
        ? 0
        : Math.min(100, (remainingCapacity / remainingHours) * 70);

  // 5) Workload spread across members with open work.
  const perMember = new Map<string, number>();
  for (const task of open) {
    if (!task.assignee_member_id) continue;
    perMember.set(
      task.assignee_member_id,
      (perMember.get(task.assignee_member_id) ?? 0) + Number(task.estimated_hours || 0),
    );
  }
  const memberHours = [...perMember.values()];
  // Nothing to balance yet: an empty project must not earn free readiness points.
  let balanceScore = totalHours > 0 ? 50 : 0;
  if (memberHours.length > 1) {
    const mean = memberHours.reduce((a, b) => a + b, 0) / memberHours.length;
    const max = Math.max(...memberHours);
    const spread = mean > 0 ? (max - mean) / mean : 0;
    balanceScore = Math.max(0, Math.min(100, 100 - spread * 120));
  } else if (memberHours.length === 1) {
    balanceScore = 70;
  }

  // 6) Plan hygiene: approved plan, testing and submission milestones scheduled.
  const hasTesting = input.milestones.some((m) => m.kind === 'testing');
  const hasSubmission = input.milestones.some((m) => m.kind === 'submission');
  const planScore =
    input.plan_status === 'approved' ? (hasTesting && hasSubmission ? 100 : 70) : input.plan_status === 'proposed' ? 40 : 10;

  const components: ReadinessComponent[] = [
    {
      key: 'progress',
      label: 'Work completed',
      score: round(progressScore),
      weight: 40,
      contribution: round(progressScore * 0.4, 1),
      detail: totalHours > 0 ? `${round(doneHours, 1)}h of ${round(totalHours, 1)}h finished` : 'No tasks yet',
    },
    {
      key: 'deadlines',
      label: 'Deadlines on track',
      score: round(deadlineScore),
      weight: 20,
      contribution: round(deadlineScore * 0.2, 1),
      detail:
        open.length === 0
          ? totalHours > 0
            ? 'Everything is done'
            : 'No tasks yet'
          : `${overdue.length} of ${open.length} open tasks overdue`,
    },
    {
      key: 'blocked',
      label: 'Unblocked work',
      score: round(blockedScore),
      weight: 10,
      contribution: round(blockedScore * 0.1, 1),
      detail: `${blocked.length} blocked task${blocked.length === 1 ? '' : 's'}`,
    },
    {
      key: 'buffer',
      label: 'Capacity vs. remaining work',
      score: round(bufferScore),
      weight: 15,
      contribution: round(bufferScore * 0.15, 1),
      detail:
        remainingHours === 0
          ? 'Nothing left to schedule'
          : `${round(remainingHours, 1)}h of work left, about ${round(remainingCapacity, 1)}h of team capacity in ${Math.max(workingDaysLeft, 0)} working day${workingDaysLeft === 1 ? '' : 's'}`,
    },
    {
      key: 'balance',
      label: 'Workload balance',
      score: round(balanceScore),
      weight: 10,
      contribution: round(balanceScore * 0.1, 1),
      detail:
        memberHours.length > 1
          ? `Open work spread across ${memberHours.length} members`
          : memberHours.length === 1
            ? 'All open work sits with one member'
            : 'No assigned open work',
    },
    {
      key: 'plan',
      label: 'Plan & checkpoints',
      score: planScore,
      weight: 5,
      contribution: round(planScore * 0.05, 1),
      detail:
        input.plan_status === 'approved'
          ? hasTesting && hasSubmission
            ? 'Approved, with testing and submission checkpoints'
            : 'Approved, but missing testing/submission checkpoints'
          : input.plan_status === 'proposed'
            ? 'Plan proposed and awaiting approval'
            : 'No approved plan yet',
    },
  ];

  const rawScore = components.reduce((sum, c) => sum + c.score * (c.weight / 100), 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  const blockers: string[] = [];
  if (input.plan_status !== 'approved') blockers.push('The task plan has not been approved yet.');
  if (overdue.length > 0) blockers.push(`${overdue.length} overdue task${overdue.length === 1 ? '' : 's'} need a new date.`);
  if (blocked.length > 0) blockers.push(`${blocked.length} task${blocked.length === 1 ? ' is' : 's are'} blocked.`);
  if (remainingHours > remainingCapacity && remainingHours > 0)
    blockers.push('Remaining work is larger than the team capacity left before the deadline.');
  if (unassigned.length > 0) blockers.push(`${unassigned.length} open task${unassigned.length === 1 ? ' has' : 's have'} no owner.`);
  if (daysLeft < 0 && open.length > 0) blockers.push('The submission deadline has passed.');

  return { score, components, blockers };
}

/**
 * In-app reminders. These are computed from live data every time the dashboard
 * loads - there is no background push/email service, and the UI says so.
 */
export function buildReminders(
  tasks: Pick<Task, 'id' | 'title' | 'status' | 'due_date' | 'assignee_member_id'>[],
  members: { id: string; display_name: string }[],
  opts: { today?: string; plan_status: PlanStatus } = { plan_status: 'none' },
): Reminder[] {
  const today = opts.today ?? todayISO();
  const nameOf = (memberId: string | null) =>
    memberId ? (members.find((m) => m.id === memberId)?.display_name ?? 'a teammate') : null;

  const reminders: Reminder[] = [];

  if (opts.plan_status !== 'approved') {
    reminders.push({
      id: 'no-plan',
      task_id: null,
      kind: 'no_plan',
      title: 'Plan needs approval',
      detail: 'Assignments are not saved until the team approves the AI plan.',
      due_date: null,
      severity: 'info',
    });
  }

  for (const task of tasks) {
    if (task.status === 'done') continue;
    const owner = nameOf(task.assignee_member_id);
    if (task.due_date && task.due_date < today) {
      reminders.push({
        id: `overdue-${task.id}`,
        task_id: task.id,
        kind: 'overdue',
        title: `Overdue: ${task.title}`,
        detail: `${owner ? `${owner} — ` : ''}was due ${task.due_date}. Update the date or mark it done.`,
        due_date: task.due_date,
        severity: 'high',
      });
    } else if (task.due_date) {
      const days = daysBetween(today, task.due_date);
      if (days <= 2) {
        reminders.push({
          id: `due-${task.id}`,
          task_id: task.id,
          kind: 'due_soon',
          title: `Due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}: ${task.title}`,
          detail: `${owner ? `Owner: ${owner}` : 'No owner yet'}.`,
          due_date: task.due_date,
          severity: days <= 1 ? 'warning' : 'info',
        });
      }
    }
    if (task.status === 'blocked') {
      reminders.push({
        id: `blocked-${task.id}`,
        task_id: task.id,
        kind: 'blocked',
        title: `Blocked: ${task.title}`,
        detail: 'Someone needs to unblock this. Ask in the project chat.',
        due_date: task.due_date,
        severity: 'warning',
      });
    }
    if (!task.assignee_member_id) {
      reminders.push({
        id: `unassigned-${task.id}`,
        task_id: task.id,
        kind: 'unassigned',
        title: `No owner: ${task.title}`,
        detail: 'Assign this task so it does not fall through the cracks.',
        due_date: task.due_date,
        severity: 'warning',
      });
    }
  }

  const order = { high: 0, warning: 1, info: 2 } as const;
  return reminders
    .sort((a, b) => order[a.severity] - order[b.severity] || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    .slice(0, 12);
}

export { toISODate, parseDate };
