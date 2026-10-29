import { useMemo } from 'react';
import { Badge, Button, Card, CardHead, EmptyState, Progress } from './ui.js';
import type { ProjectBundle } from '../lib/data.js';
import { computeReadiness, buildReminders } from '../shared/readiness.js';
import { todayISO } from '../shared/dates.js';
import type { MemberLoad } from '../shared/types.js';

function tone(value: number) {
  if (value >= 75) return 'ok' as const;
  if (value >= 45) return 'warn' as const;
  return 'danger' as const;
}

export default function ProjectOverview({
  bundle,
  onOpenTasks,
  onGeneratePlan,
  generating,
}: {
  bundle: ProjectBundle;
  onOpenTasks: () => void;
  onGeneratePlan: () => void;
  generating: boolean;
}) {
  const { project, tasks, milestones, members } = bundle;
  const today = todayISO();

  const readiness = useMemo(
    () =>
      computeReadiness({
        tasks,
        milestones,
        plan_status: project.plan_status,
        deadline: project.deadline,
        weekly_capacity_hours: members.reduce((sum, member) => sum + Number(member.hours_per_week || 0), 0),
        member_ids: members.map((member) => member.id),
        today,
      }),
    [tasks, milestones, project.plan_status, project.deadline, members, today],
  );

  const reminders = useMemo(
    () => buildReminders(tasks, members, { today, plan_status: project.plan_status }),
    [tasks, members, today, project.plan_status],
  );

  const openTasks = tasks.filter((task) => task.status !== 'done');
  const overdue = openTasks.filter((task) => task.due_date && task.due_date < today);
  const blocked = openTasks.filter((task) => task.status === 'blocked');
  const unassigned = openTasks.filter((task) => !task.assignee_member_id);
  const upcoming = [...openTasks]
    .filter((task) => task.due_date && task.due_date >= today)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
    .slice(0, 6);

  const totalHours = tasks.reduce((sum, task) => sum + Number(task.estimated_hours || 0), 0);
  const doneHours = tasks
    .filter((task) => task.status === 'done')
    .reduce((sum, task) => sum + Number(task.estimated_hours || 0), 0);

  const loads: { load: MemberLoad; memberId: string }[] = members.map((member) => {
    const mine = tasks.filter((task) => task.assignee_member_id === member.id);
    const assigned = mine.reduce((sum, task) => sum + Number(task.estimated_hours || 0), 0);
    const capacity = Math.max(1, Number(member.hours_per_week || 0) * 3);
    const utilization = assigned / capacity;
    return {
      memberId: member.id,
      load: {
        member_id: member.id,
        display_name: member.display_name,
        assigned_hours: assigned,
        capacity_hours: capacity,
        utilization,
        task_count: mine.length,
        skill_match_pct: 0,
        hours_by_phase: {},
        status: utilization > 1.05 ? 'over_capacity' : utilization > 0.85 ? 'tight' : utilization < 0.3 ? 'underloaded' : 'balanced',
      },
    };
  });

  return (
    <div className="stack">
      {project.plan_status !== 'approved' ? (
        <Card>
          <div className="card__body row row--between" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div className="stack stack--sm">
              <strong>No approved plan yet</strong>
              <span className="small muted">
                Ask the AI to break the brief into tasks, then approve the split. Nothing is assigned until you do.
              </span>
            </div>
            <Button variant="primary" onClick={onGeneratePlan} loading={generating}>
              {project.plan_status === 'proposed' ? 'Review pending plan' : 'Generate plan with AI'}
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="grid grid--stats">
        <div className="stat">
          <span className="stat__label">Work done</span>
          <span className="stat__value">
            {Math.round(doneHours)}<span className="small muted"> / {Math.round(totalHours)}h</span>
          </span>
          <Progress value={totalHours > 0 ? (doneHours / totalHours) * 100 : 0} tone="brand" />
        </div>
        <div className="stat">
          <span className="stat__label">Open tasks</span>
          <span className="stat__value">{openTasks.length}</span>
          <span className="small muted">{tasks.length} total</span>
        </div>
        <div className="stat">
          <span className="stat__label">Overdue</span>
          <span className="stat__value" style={{ color: overdue.length ? 'var(--danger)' : undefined }}>
            {overdue.length}
          </span>
          <span className="small muted">{blocked.length} blocked</span>
        </div>
        <div className="stat">
          <span className="stat__label">Days to deadline</span>
          <span className="stat__value">{Math.max(0, Math.round((Date.parse(project.deadline) - Date.parse(today)) / 86400000))}</span>
          <span className="small muted">{project.deadline}</span>
        </div>
      </div>

      <div className="grid grid--2">
        <Card className="readiness">
          <CardHead title="Readiness score" subtitle="Every point below is explainable." />
          <div className="card__body stack">
            <div className="readiness__score">
              <span className="readiness__value" style={{ color: `var(--${tone(readiness.score) === 'danger' ? 'danger' : tone(readiness.score) === 'warn' ? 'warn' : 'ok'})` }}>
                {readiness.score}
              </span>
              <span className="small muted">/ 100</span>
            </div>
            <div className="readiness__breakdown">
              {readiness.components.map((component) => (
                <div key={component.key} className="readiness__row">
                  <div className="row row--between">
                    <span className="small">{component.label}</span>
                    <span className="small mono-num muted">
                      {Math.round(component.score)}/100 · weight {Math.round(component.weight * 100)}%
                    </span>
                  </div>
                  <Progress value={component.score} tone={tone(component.score)} />
                  <span className="small muted">{component.detail}</span>
                </div>
              ))}
            </div>
            {readiness.blockers.length > 0 ? (
              <div className="stack stack--sm">
                {readiness.blockers.map((blocker, index) => (
                  <Badge key={index} tone="warn">
                    {blocker}
                  </Badge>
                ))}
              </div>
            ) : (
              <Badge tone="ok">No structural blockers</Badge>
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Reminders" subtitle="Calculated from live data each time this page opens." />
          <div className="card__body stack">
            {reminders.length === 0 ? (
              <EmptyState title="Nothing needs attention">
                <span className="small muted">No overdue, blocked or unassigned work right now.</span>
              </EmptyState>
            ) : (
              reminders.slice(0, 8).map((reminder) => (
                <div key={reminder.id} className="task-row">
                  <div className="row row--between" style={{ flex: 1 }}>
                    <div className="stack stack--sm">
                      <strong className="small">{reminder.title}</strong>
                      <span className="small muted">{reminder.detail}</span>
                    </div>
                    <Badge tone={reminder.severity === 'high' ? 'danger' : reminder.severity === 'warning' ? 'warn' : 'muted'}>
                      {reminder.kind.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>
              ))
            )}
            <p className="small muted" style={{ margin: 0 }}>
              In-app only — TeamPilot does not send background push or email reminders.
            </p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead
          title="Workload per person"
          subtitle="Hours remaining against a three-week share of weekly availability."
          actions={<Button size="sm" onClick={onOpenTasks}>Open task board</Button>}
        />
        <div className="card__body stack">
          {loads.map(({ load, memberId }) => (
            <div key={memberId} className="member-row">
              <div className="member-row__main">
                <div className="row row--between">
                  <strong>{load.display_name}</strong>
                  <span className="small muted mono-num">
                    {Math.round(load.assigned_hours * 10) / 10}h · {load.task_count} task{load.task_count === 1 ? '' : 's'}
                  </span>
                </div>
                <Progress
                  value={Math.min(100, load.utilization * 100)}
                  tone={load.utilization > 1.05 ? 'danger' : load.utilization > 0.85 ? 'warn' : 'ok'}
                />
                <div className="row row--between small muted">
                  <span>{Math.round(load.utilization * 100)}% of share</span>
                  <Badge tone={load.utilization > 1.05 ? 'danger' : load.utilization > 0.85 ? 'warn' : 'ok'}>
                    {load.status.replace('_', ' ')}
                  </Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid--2">
        <Card>
          <CardHead title="Upcoming deadlines" />
          <div className="card__body stack">
            {upcoming.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>Nothing scheduled ahead.</p>
            ) : (
              upcoming.map((task) => (
                <div key={task.id} className="row row--between small">
                  <span>{task.title}</span>
                  <span className="mono-num muted">{task.due_date}</span>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Needs attention now" />
          <div className="card__body stack">
            {overdue.slice(0, 4).map((task) => (
              <div key={`o-${task.id}`} className="row row--between small">
                <span>{task.title}</span>
                <Badge tone="danger">overdue {task.due_date}</Badge>
              </div>
            ))}
            {blocked.slice(0, 4).map((task) => (
              <div key={`b-${task.id}`} className="row row--between small">
                <span>{task.title}</span>
                <Badge tone="warn">blocked</Badge>
              </div>
            ))}
            {unassigned.slice(0, 4).map((task) => (
              <div key={`u-${task.id}`} className="row row--between small">
                <span>{task.title}</span>
                <Badge tone="muted">unassigned</Badge>
              </div>
            ))}
            {overdue.length + blocked.length + unassigned.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>All open work is assigned and on schedule.</p>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
