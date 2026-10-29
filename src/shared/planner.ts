/**
 * Deterministic fair-workload planner.
 *
 * The AI is good at *breaking the project down*. It is not reliable at doing
 * arithmetic under constraints, so we do that here, in plain TypeScript, with
 * no LLM involved:
 *
 *   1. capacity   - each member gets hours_per_week / 5 per working day
 *   2. ordering   - dependency-safe order (topological), heaviest first
 *   3. assignment - greedy scoring on utilisation, skill fit, experience fit
 *                   and continuity (same person keeps dependent tasks)
 *   4. schedule   - real calendar dates, weekdays only, respecting dependencies
 *   5. review     - quantify imbalances and at-risk work
 *
 * The result is reproducible: the same inputs always produce the same plan,
 * which is what makes it testable.
 */

import {
  addBusinessDays,
  businessDaysBetween,
  nextBusinessDay,
  parseDate,
  toISODate,
  addDays,
  isWeekend,
} from './dates.js';
import type {
  Experience,
  ImbalanceFlag,
  MemberInput,
  MemberLoad,
  PlanResult,
  PlannedTask,
  PlannedTaskInput,
  TimelineEntry,
} from './types.js';

const EXPERIENCE_RANK: Record<Experience, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
};

const DEFAULT_PHASE = 'Build';

function normaliseSkill(skill: string): string {
  return skill.trim().toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function skillMatch(member: MemberInput, required: string[]): number {
  const need = required.map(normaliseSkill).filter(Boolean);
  if (need.length === 0) return 0.6; // no specific skill required: neutral
  const have = new Set(member.skills.map(normaliseSkill));
  const matched = need.filter((skill) => have.has(skill)).length;
  return matched / need.length;
}

function experienceAffinity(member: MemberInput, complexity: number): number {
  const needed = complexity <= 2 ? 1 : complexity <= 3 ? 2 : 3;
  const gap = Math.abs(EXPERIENCE_RANK[member.experience] - needed);
  return clamp(1 - gap * 0.4, 0, 1);
}

/** Recursively resolve a dependency key to the leaf tasks that actually need doing. */
function leafDependencies(
  key: string,
  childrenOf: Map<string, string[]>,
  inputByKey: Map<string, PlannedTaskInput>,
  seen = new Set<string>(),
): string[] {
  if (seen.has(key)) return [];
  seen.add(key);
  const children = childrenOf.get(key) ?? [];
  if (children.length === 0) return [key];
  return children.flatMap((child) => leafDependencies(child, childrenOf, inputByKey, seen));
}

/**
 * Topological order of leaf tasks. If the AI produced a dependency cycle we
 * fall back to input order for the offending tasks instead of hanging.
 */
function orderLeaves(
  leaves: PlannedTaskInput[],
  depsOf: Map<string, string[]>,
): PlannedTaskInput[] {
  const byKey = new Map(leaves.map((t) => [t.key, t]));
  const remaining = new Map<string, Set<string>>();
  for (const task of leaves) {
    remaining.set(task.key, new Set((depsOf.get(task.key) ?? []).filter((k) => byKey.has(k))));
  }
  const ordered: PlannedTaskInput[] = [];
  const placed = new Set<string>();

  // Heaviest-first tie break, so long tasks get the pick of the team.
  const byWeight = [...leaves].sort((a, b) => b.estimated_hours - a.estimated_hours || a.key.localeCompare(b.key));

  while (ordered.length < leaves.length) {
    let progressed = false;
    for (const task of byWeight) {
      if (placed.has(task.key)) continue;
      const deps = remaining.get(task.key)!;
      if ([...deps].every((dep) => placed.has(dep))) {
        ordered.push(task);
        placed.add(task.key);
        progressed = true;
      }
    }
    if (!progressed) {
      // Cycle: drop the strongest remaining blocker so we always terminate.
      const stuck = byWeight.find((t) => !placed.has(t.key));
      if (!stuck) break;
      ordered.push(stuck);
      placed.add(stuck.key);
    }
  }
  return ordered;
}

function businessDayCapacity(hoursPerWeek: number): number {
  return Math.max(hoursPerWeek / 5, 0.5);
}

/**
 * Turn a flat task list into a plan with owners and calendar dates.
 */
export function balanceWorkload(
  rawTasks: PlannedTaskInput[],
  members: MemberInput[],
  project: { start_date: string; deadline: string },
): PlanResult {
  const assumptions: string[] = [];
  const tasks: PlannedTask[] = rawTasks.map((task, index) => ({
    ...task,
    key: task.key || `task-${index + 1}`,
    parent_key: task.parent_key ?? null,
    description: task.description ?? '',
    required_skills: (task.required_skills ?? []).map((s) => s.trim()).filter(Boolean),
    depends_on: [...new Set(task.depends_on ?? [])],
    phase: task.phase?.trim() || DEFAULT_PHASE,
    estimated_hours: clamp(Number(task.estimated_hours) || 1, 0.5, 80),
    complexity: clamp(Math.round(Number(task.complexity) || 3), 1, 5),
    is_group: false,
    assignee_member_id: null,
    assignee_name: null,
    start_date: null,
    due_date: null,
    at_risk: false,
  }));

  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const childrenOf = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.parent_key && byKey.has(task.parent_key)) {
      childrenOf.set(task.parent_key, [...(childrenOf.get(task.parent_key) ?? []), task.key]);
    } else if (task.parent_key && !byKey.has(task.parent_key)) {
      task.parent_key = null;
      assumptions.push(`Subtask "${task.title}" pointed at a missing parent; treated it as a top-level task.`);
    }
  }
  for (const task of tasks) {
    if (childrenOf.has(task.key)) {
      task.is_group = true;
      const childHours = sumHours(task.key, childrenOf, byKey);
      if (Math.abs(childHours - task.estimated_hours) > 0.5) {
        task.estimated_hours = childHours;
      }
    }
  }

  // ----- dependencies (expand group references to their subtasks) -----------
  const inputByKey = new Map(tasks.map((t) => [t.key, t as PlannedTaskInput]));
  const depsOf = new Map<string, string[]>();
  for (const task of tasks) {
    const expanded = new Set<string>();
    for (const dep of task.depends_on) {
      for (const leaf of leafDependencies(dep, childrenOf, inputByKey)) {
        if (leaf !== task.key) expanded.add(leaf);
      }
    }
    depsOf.set(task.key, [...expanded]);
  }

  const leaves = tasks.filter((t) => !t.is_group);
  const ordered = orderLeaves(leaves, depsOf);

  const projectStart = nextBusinessDay(parseDate(project.start_date));
  const deadlineDate = parseDate(project.deadline);
  const workingDays = Math.max(1, businessDaysBetween(toISODate(projectStart), project.deadline));

  // ----- capacity ----------------------------------------------------------
  const capacityOf = new Map<string, number>();
  const loadOf = new Map<string, number>();
  for (const member of members) {
    const daily = businessDayCapacity(Number(member.hours_per_week) || 5);
    capacityOf.set(member.id, round(daily * workingDays, 2));
    loadOf.set(member.id, 0);
  }

  const assignedTo = new Map<string, string>(); // task key -> member id

  // ----- assignment --------------------------------------------------------
  for (const task of ordered) {
    if (members.length === 0) break;

    const depOwners = new Set(
      (depsOf.get(task.key) ?? [])
        .map((dep) => assignedTo.get(dep))
        .filter((value): value is string => Boolean(value)),
    );

    let best: { member: MemberInput; score: number } | null = null;
    for (const member of members) {
      const capacity = capacityOf.get(member.id) ?? 1;
      const loadAfter = (loadOf.get(member.id) ?? 0) + task.estimated_hours;
      const utilisation = loadAfter / Math.max(capacity, 0.5);

      const fit = skillMatch(member, task.required_skills);
      const affinity = experienceAffinity(member, task.complexity);
      const continuity = depOwners.has(member.id) ? 1 : 0;
      const overload = utilisation > 1 ? (utilisation - 1) * 2.2 : 0;

      const score =
        -1.6 * utilisation + 0.9 * fit + 0.35 * affinity + 0.2 * continuity - overload;

      if (!best || score > best.score) best = { member, score };
    }

    const chosen = best!.member;
    assignedTo.set(task.key, chosen.id);
    loadOf.set(chosen.id, round((loadOf.get(chosen.id) ?? 0) + task.estimated_hours, 2));
    task.assignee_member_id = chosen.id;
    task.assignee_name = chosen.display_name;
  }

  if (members.length === 0) {
    assumptions.push('No team members were provided, so tasks could not be assigned.');
  }

  // Groups inherit the member doing most of their subtasks (display only).
  for (const task of tasks) {
    if (!task.is_group) continue;
    const totals = new Map<string, number>();
    for (const childKey of childrenOf.get(task.key) ?? []) {
      const child = byKey.get(childKey);
      if (!child?.assignee_member_id) continue;
      totals.set(
        child.assignee_member_id,
        (totals.get(child.assignee_member_id) ?? 0) + child.estimated_hours,
      );
    }
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      task.assignee_member_id = top[0];
      task.assignee_name = members.find((m) => m.id === top[0])?.display_name ?? null;
    }
  }

  // ----- schedule ----------------------------------------------------------
  const memberPointer = new Map<string, Date>();
  const endOf = new Map<string, Date>();

  for (const task of ordered) {
    const memberId = assignedTo.get(task.key);
    if (!memberId) continue;

    const member = members.find((m) => m.id === memberId)!;
    const daily = businessDayCapacity(Number(member.hours_per_week) || 5);
    const durationDays = Math.max(1, Math.ceil(task.estimated_hours / daily));

    let start = memberPointer.get(memberId) ?? projectStart;
    if (start < projectStart) start = projectStart;
    for (const depKey of depsOf.get(task.key) ?? []) {
      const depEnd = endOf.get(depKey);
      if (depEnd) {
        const earliest = nextBusinessDay(addDays(depEnd, 1));
        if (earliest > start) start = earliest;
      }
    }
    start = nextBusinessDay(start);
    const end = addBusinessDays(start, durationDays - 1);

    endOf.set(task.key, end);
    memberPointer.set(memberId, nextBusinessDay(addDays(end, 1)));

    task.start_date = toISODate(start);
    task.due_date = toISODate(end);
    task.at_risk = end > deadlineDate;
  }

  for (const task of tasks) {
    if (!task.is_group) continue;
    const childDue = (childrenOf.get(task.key) ?? [])
      .map((k) => endOf.get(k))
      .filter((value): value is Date => Boolean(value));
    const childStart = (childrenOf.get(task.key) ?? [])
      .map((k) => byKey.get(k)?.start_date)
      .filter((value): value is string => Boolean(value))
      .sort();
    if (childDue.length > 0) {
      const latest = new Date(Math.max(...childDue.map((d) => d.getTime())));
      task.due_date = toISODate(latest);
      task.at_risk = latest > deadlineDate;
    }
    if (childStart.length > 0) task.start_date = childStart[0];
  }

  // ----- loads -------------------------------------------------------------
  const loads: MemberLoad[] = members.map((member) => {
    const own = leaves.filter((t) => t.assignee_member_id === member.id);
    const assignedHours = round(own.reduce((sum, t) => sum + t.estimated_hours, 0), 2);
    const capacity = capacityOf.get(member.id) ?? 0;
    const utilisation = capacity > 0 ? round(assignedHours / capacity, 2) : 0;

    let weightedFit = 0;
    let weightSum = 0;
    const hoursByPhase: Record<string, number> = {};
    for (const task of own) {
      weightedFit += skillMatch(member, task.required_skills) * task.estimated_hours;
      weightSum += task.estimated_hours;
      hoursByPhase[task.phase] = round((hoursByPhase[task.phase] ?? 0) + task.estimated_hours, 2);
    }

    const status: MemberLoad['status'] =
      utilisation > 1.02
        ? 'over_capacity'
        : utilisation > 0.85
          ? 'tight'
          : utilisation < 0.5
            ? 'underloaded'
            : 'balanced';

    return {
      member_id: member.id,
      display_name: member.display_name,
      assigned_hours: assignedHours,
      capacity_hours: capacity,
      utilization: utilisation,
      task_count: own.length,
      skill_match_pct: weightSum > 0 ? Math.round((weightedFit / weightSum) * 100) : 0,
      hours_by_phase: hoursByPhase,
      status,
    };
  });

  // ----- imbalance review --------------------------------------------------
  const flags: ImbalanceFlag[] = [];
  const withWork = loads.filter((l) => l.assigned_hours > 0);
  const meanHours =
    withWork.length > 0 ? withWork.reduce((sum, l) => sum + l.assigned_hours, 0) / withWork.length : 0;

  for (const load of loads) {
    if (load.capacity_hours <= 0) continue;
    if (load.status === 'over_capacity') {
      flags.push({
        member_id: load.member_id,
        member_name: load.display_name,
        severity: 'high',
        message: `${load.display_name} is over capacity: ${load.assigned_hours}h of work against ${load.capacity_hours}h available (${Math.round(load.utilization * 100)}%).`,
      });
    } else if (load.status === 'tight') {
      flags.push({
        member_id: load.member_id,
        member_name: load.display_name,
        severity: 'warning',
        message: `${load.display_name} is at ${Math.round(load.utilization * 100)}% of available hours - little room for slippage.`,
      });
    } else if (load.status === 'underloaded' && meanHours > 0 && load.assigned_hours < meanHours * 0.7) {
      flags.push({
        member_id: load.member_id,
        member_name: load.display_name,
        severity: 'info',
        message: `${load.display_name} has spare capacity (${load.assigned_hours}h vs team average ${round(meanHours, 1)}h) and could take work from an overloaded teammate.`,
      });
    }
    if (load.skill_match_pct > 0 && load.skill_match_pct < 55 && load.assigned_hours > 0) {
      flags.push({
        member_id: load.member_id,
        member_name: load.display_name,
        severity: 'info',
        message: `Only ${load.skill_match_pct}% of ${load.display_name}'s hours match their listed skills - consider rebalancing or pairing.`,
      });
    }
  }

  if (withWork.length > 1 && meanHours > 0) {
    const max = Math.max(...withWork.map((l) => l.assigned_hours));
    const min = Math.min(...withWork.map((l) => l.assigned_hours));
    if (max - min > Math.max(4, meanHours * 0.35)) {
      flags.push({
        member_id: null,
        member_name: 'Team',
        severity: 'warning',
        message: `Workload spread is uneven: ${round(max, 1)}h for the busiest member vs ${round(min, 1)}h for the quietest (${Math.round((max / meanHours - 1) * 100)}% above average).`,
      });
    }
  }

  const atRisk = leaves.filter((t) => t.at_risk);
  if (atRisk.length > 0) {
    flags.push({
      member_id: null,
      member_name: 'Timeline',
      severity: 'high',
      message: `${atRisk.length} task${atRisk.length === 1 ? '' : 's'} finish after the submission deadline. Reduce scope, raise hours per week, or move the deadline.`,
    });
  }

  const known = new Set(members.flatMap((m) => m.skills.map(normaliseSkill)));
  const unknownSkills = [
    ...new Set(leaves.flatMap((t) => t.required_skills.map(normaliseSkill))),
  ].filter((skill) => !known.has(skill));
  if (unknownSkills.length > 0) {
    flags.push({
      member_id: null,
      member_name: 'Skills',
      severity: 'info',
      message: `Nobody listed these skills: ${unknownSkills.slice(0, 6).join(', ')}. Those tasks may need research time or a workshop.`,
    });
  }

  const unassigned = leaves.filter((t) => !t.assignee_member_id);
  if (unassigned.length > 0 && members.length > 0) {
    flags.push({
      member_id: null,
      member_name: 'Assignments',
      severity: 'warning',
      message: `${unassigned.length} task${unassigned.length === 1 ? '' : 's'} could not be assigned automatically.`,
    });
  }

  // ----- timeline ----------------------------------------------------------
  const timeline = buildTimeline(tasks, project, childrenOf);

  const estimatedHours = round(leaves.reduce((sum, t) => sum + t.estimated_hours, 0), 2);
  const capacityHours = round(members.reduce((sum, m) => sum + (capacityOf.get(m.id) ?? 0), 0), 2);

  if (withWork.length > 0 && estimatedHours > capacityHours) {
    flags.push({
      member_id: null,
      member_name: 'Capacity',
      severity: 'high',
      message: `The plan needs ${estimatedHours}h but the team only has about ${capacityHours}h before the deadline. Expect an overloaded final week.`,
    });
  }

  return {
    tasks,
    loads,
    flags,
    timeline,
    assumptions,
    totals: {
      estimated_hours: estimatedHours,
      capacity_hours: capacityHours,
      task_count: leaves.length,
      start_date: toISODate(projectStart),
      deadline: project.deadline,
      working_days: workingDays,
    },
  };
}

function sumHours(key: string, childrenOf: Map<string, string[]>, byKey: Map<string, PlannedTask>): number {
  const children = childrenOf.get(key) ?? [];
  if (children.length === 0) return byKey.get(key)?.estimated_hours ?? 0;
  return round(
    children.reduce((sum, child) => {
      const childTask = byKey.get(child);
      if (!childTask) return sum;
      if (childrenOf.has(child)) return sum + sumHours(child, childrenOf, byKey);
      return sum + childTask.estimated_hours;
    }, 0),
    2,
  );
}

/**
 * Timeline with an explicit testing window and submission preparation, because
 * students almost always forget both.
 */
export function buildTimeline(
  tasks: PlannedTask[],
  project: { start_date: string; deadline: string },
  childrenOf?: Map<string, string[]>,
): TimelineEntry[] {
  const leaves = tasks.filter((t) => !t.is_group && t.due_date);
  const entries: TimelineEntry[] = [];
  if (leaves.length === 0) {
    return [
      {
        title: 'Kick-off',
        description: 'Approve the plan and confirm each member’s responsibilities.',
        start_date: project.start_date,
        due_date: project.start_date,
        kind: 'milestone',
      },
      {
        title: 'Final submission',
        description: 'Submit the deliverables before the deadline.',
        start_date: null,
        due_date: project.deadline,
        kind: 'submission',
      },
    ];
  }

  const sortedDue = [...leaves].sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1));
  const deadline = project.deadline;
  const lastBuildDue = sortedDue
    .filter((t) => !/test|qa|submission|polish|review/i.test(t.phase))
    .map((t) => t.due_date!)
    .pop();

  entries.push({
    title: 'Kick-off & plan approval',
    description: 'Everyone confirms their tasks, hours and deadlines.',
    start_date: project.start_date,
    due_date: project.start_date,
    kind: 'milestone',
  });

  if (lastBuildDue) {
    entries.push({
      title: 'Core build complete',
      description: 'All build tasks are done and the project is feature-complete enough to test.',
      start_date: project.start_date,
      due_date: lastBuildDue,
      kind: 'phase',
    });
  }

  const testingStart = nextBusinessDay(
    addDays(parseDate(lastBuildDue ?? project.start_date), 1),
  );
  const submissionPrepStart = nextBusinessDay(addDays(parseDate(deadline), -2));
  const testingEnd = addBusinessDays(testingStart, 2);

  entries.push({
    title: 'Testing & bug fixing',
    description: 'Run the test plan, fix defects, and give the team time to review each other’s work.',
    start_date: toISODate(testingStart),
    due_date: toISODate(testingEnd > parseDate(deadline) ? parseDate(deadline) : testingEnd),
    kind: 'testing',
  });

  entries.push({
    title: 'Final submission preparation',
    description: 'Write the report, check deliverables against the brief, rehearse the demo.',
    start_date: toISODate(submissionPrepStart),
    due_date: deadline,
    kind: 'submission',
  });

  entries.push({
    title: 'Submit project',
    description: 'Final upload before the deadline. Leave buffer for upload problems.',
    start_date: null,
    due_date: deadline,
    kind: 'submission',
  });

  if (childrenOf) {
    // Group-level milestones for the AI's own phases are already represented by
    // the tasks tab; keep the timeline focused on the four checkpoints above.
  }

  // De-duplicate by title keeping the earliest due date.
  const seen = new Map<string, TimelineEntry>();
  for (const entry of entries) {
    if (!seen.has(entry.title)) seen.set(entry.title, entry);
  }
  return [...seen.values()];
}

/** Business days remaining until the deadline (0 when past). */
export function workingDaysLeft(deadline: string, today: string): number {
  return businessDaysBetween(today, deadline);
}

export { isWeekend };
