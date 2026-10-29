import { describe, expect, it } from 'vitest';
import { balanceWorkload } from '../src/shared/planner.js';
import type { MemberInput, PlannedTaskInput } from '../src/shared/types.js';

const project = { start_date: '2026-03-02', deadline: '2026-04-10' };

const members: MemberInput[] = [
  {
    id: 'm1',
    display_name: 'Ada',
    skills: ['react', 'typescript', 'ui'],
    experience: 'advanced',
    hours_per_week: 20,
  },
  {
    id: 'm2',
    display_name: 'Grace',
    skills: ['python', 'database', 'testing'],
    experience: 'intermediate',
    hours_per_week: 10,
  },
  {
    id: 'm3',
    display_name: 'Linus',
    skills: ['node', 'api', 'devops'],
    experience: 'beginner',
    hours_per_week: 6,
  },
];

function task(over: Partial<PlannedTaskInput> & { key: string; title: string }): PlannedTaskInput {
  return {
    estimated_hours: 4,
    complexity: 3,
    required_skills: [],
    depends_on: [],
    phase: 'Build',
    ...over,
  };
}

const sampleTasks: PlannedTaskInput[] = [
  task({ key: 't1', title: 'Design database schema', required_skills: ['database'], estimated_hours: 6 }),
  task({ key: 't2', title: 'Build UI shell', required_skills: ['react'], estimated_hours: 8 }),
  task({ key: 't3', title: 'API endpoints', required_skills: ['api'], estimated_hours: 10, depends_on: ['t1'] }),
  task({ key: 't4', title: 'Write tests', required_skills: ['testing'], estimated_hours: 5, depends_on: ['t3'] }),
  task({ key: 't5', title: 'Deploy', required_skills: ['devops'], estimated_hours: 3, depends_on: ['t4'] }),
];

describe('balanceWorkload', () => {
  const plan = balanceWorkload(sampleTasks, members, project);

  it('assigns every leaf task to a real member', () => {
    const leaves = plan.tasks.filter((t) => !t.is_group);
    expect(leaves).toHaveLength(sampleTasks.length);
    for (const leaf of leaves) {
      expect(leaf.assignee_member_id).toBeTruthy();
      expect(members.map((m) => m.id)).toContain(leaf.assignee_member_id);
      expect(leaf.assignee_name).toBeTruthy();
    }
  });

  it('gives hours in proportion to availability instead of task counts', () => {
    const byMember = new Map(plan.loads.map((l) => [l.member_id, l]));
    const ada = byMember.get('m1')!;
    const grace = byMember.get('m2')!;
    const linus = byMember.get('m3')!;

    // Ada has 20 h/week, Linus 6 h/week — she should carry more hours but keep
    // a similar utilisation ratio, which is the whole point of the balancer.
    expect(ada.assigned_hours).toBeGreaterThan(linus.assigned_hours);
    expect(ada.utilization).toBeGreaterThan(0.4);
    expect(linus.utilization).toBeLessThan(1.35);
  });

  it('schedules dependent tasks after their prerequisite finishes', () => {
    const byKey = new Map(plan.tasks.map((t) => [t.key, t]));
    for (const current of plan.tasks) {
      for (const depKey of current.depends_on) {
        const dep = byKey.get(depKey)!;
        expect(dep.due_date).toBeTruthy();
        expect(current.start_date).toBeTruthy();
        expect(current.start_date! > dep.due_date!).toBe(true);
      }
    }
  });

  it('produces a testing window and a submission preparation entry', () => {
    const kinds = plan.timeline.map((entry) => entry.kind);
    expect(kinds).toContain('testing');
    expect(kinds).toContain('submission');
    for (const entry of plan.timeline) {
      expect(entry.due_date).toBeTruthy();
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });

  it('records the project start and deadline in the totals', () => {
    expect(plan.totals.start_date).toBe(project.start_date);
    expect(plan.totals.deadline).toBe(project.deadline);
    expect(plan.totals.task_count).toBe(sampleTasks.length);
    expect(plan.totals.estimated_hours).toBe(
      sampleTasks.reduce((sum, t) => sum + t.estimated_hours, 0),
    );
  });
});

describe('balanceWorkload edge cases', () => {
  it('flags a team that cannot fit the work in time', () => {
    const heavy = [
      task({ key: 'h1', title: 'Huge thing', estimated_hours: 60 }),
      task({ key: 'h2', title: 'Another huge thing', estimated_hours: 60 }),
    ];
    const plan = balanceWorkload(heavy, [members[2]], {
      start_date: '2026-03-02',
      deadline: '2026-03-06',
    });
    expect(plan.flags.length).toBeGreaterThan(0);
    expect(plan.loads[0].status).toBe('over_capacity');
    expect(plan.tasks.some((t) => t.at_risk)).toBe(true);
  });

  it('handles a team with no members without crashing', () => {
    const plan = balanceWorkload(sampleTasks, [], project);
    expect(plan.tasks.every((t) => t.assignee_member_id === null)).toBe(true);
    expect(plan.assumptions.join(' ')).toMatch(/no team members/i);
  });

  it('rolls subtask hours into the parent task', () => {
    const withSubs: PlannedTaskInput[] = [
      task({ key: 'p1', title: 'Build feature', estimated_hours: 1 }),
      task({ key: 'p1a', title: 'Part A', parent_key: 'p1', estimated_hours: 4 }),
      task({ key: 'p1b', title: 'Part B', parent_key: 'p1', estimated_hours: 6 }),
    ];
    const plan = balanceWorkload(withSubs, members, project);
    const parent = plan.tasks.find((t) => t.key === 'p1')!;
    expect(parent.is_group).toBe(true);
    expect(parent.estimated_hours).toBe(10);
    expect(parent.assignee_member_id).toBeTruthy();
  });
});
