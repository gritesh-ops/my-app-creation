import { describe, expect, it } from 'vitest';
import { buildReminders, computeReadiness } from '../src/shared/readiness.js';
import type { Task } from '../src/shared/types.js';

function makeTask(over: Partial<Task> & { id: string }): Task {
  return {
    project_id: 'p1',
    parent_task_id: null,
    title: 'Task',
    description: '',
    estimated_hours: 4,
    complexity: 3,
    required_skills: [],
    phase: 'Build',
    assignee_member_id: 'm1',
    start_date: '2026-03-02',
    due_date: '2026-03-10',
    status: 'todo',
    is_group: false,
    position: 0,
    created_at: '2026-03-01T00:00:00Z',
    ...over,
  };
}

describe('computeReadiness', () => {
  it('returns an explainable score that adds up from its components', () => {
    const result = computeReadiness({
      tasks: [
        makeTask({ id: 'a', estimated_hours: 10, status: 'done' }),
        makeTask({ id: 'b', estimated_hours: 10, status: 'todo' }),
      ],
      milestones: [
        { title: 'Testing', kind: 'testing', due_date: '2026-03-20' },
        { title: 'Submit', kind: 'submission', due_date: '2026-03-25' },
      ],
      plan_status: 'approved',
      deadline: '2026-03-25',
      today: '2026-03-05',
      weekly_capacity_hours: 30,
    });

    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.components).toHaveLength(6);
    const weights = result.components.reduce((sum, c) => sum + c.weight, 0);
    expect(weights).toBe(100);
    const contribution = result.components.reduce((sum, c) => sum + c.contribution, 0);
    expect(Math.round(contribution)).toBe(Math.round(result.score));
    for (const component of result.components) {
      expect(component.detail.length).toBeGreaterThan(0);
    }
  });

  it('scores an empty project at zero and says why', () => {
    const result = computeReadiness({
      tasks: [],
      milestones: [],
      plan_status: 'none',
      deadline: '2026-03-25',
      today: '2026-03-05',
      weekly_capacity_hours: 0,
    });
    expect(result.score).toBe(0);
    expect(result.components.find((c) => c.key === 'plan')!.score).toBe(10);
  });

  it('reports blockers for overdue, blocked and unassigned work', () => {
    const result = computeReadiness({
      tasks: [
        makeTask({ id: 'late', due_date: '2026-03-01' }),
        makeTask({ id: 'stuck', status: 'blocked' }),
        makeTask({ id: 'nobody', assignee_member_id: null }),
      ],
      milestones: [],
      plan_status: 'proposed',
      deadline: '2026-03-25',
      today: '2026-03-05',
      weekly_capacity_hours: 20,
    });
    const text = result.blockers.join(' | ');
    expect(text).toMatch(/overdue/i);
    expect(text).toMatch(/blocked/i);
    expect(text).toMatch(/unassigned/i);
  });
});

describe('buildReminders', () => {
  it('only creates reminders from real task and plan state', () => {
    const tasks = [
      makeTask({ id: 'late', title: 'Late task', due_date: '2026-03-01' }),
      makeTask({ id: 'soon', title: 'Soon task', due_date: '2026-03-06' }),
      makeTask({ id: 'stuck', title: 'Stuck task', status: 'blocked' }),
      makeTask({ id: 'done', title: 'Done task', status: 'done', due_date: '2026-03-01' }),
    ];
    const reminders = buildReminders({ tasks, plan_status: 'approved', today: '2026-03-05' });
    const kinds = new Set(reminders.map((r) => r.kind));
    expect(kinds.has('overdue')).toBe(true);
    expect(kinds.has('due_soon')).toBe(true);
    expect(kinds.has('blocked')).toBe(true);
    expect(reminders.some((r) => r.task_id === 'done')).toBe(false);
    expect(reminders.some((r) => r.kind === 'no_plan')).toBe(false);
  });

  it('asks for a plan when none was approved', () => {
    const reminders = buildReminders({ tasks: [], plan_status: 'none', today: '2026-03-05' });
    expect(reminders.map((r) => r.kind)).toContain('no_plan');
  });
});
