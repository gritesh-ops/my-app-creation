/**
 * Plan preview + approval.
 *
 * Used by the creation wizard and by the project page. Nothing is written to the
 * database until the student presses "Approve & save" — the AI output lives in
 * ai_suggestions until then, and apply_plan() copies it into tasks/milestones.
 */

import { Alert, Badge, Button, Progress } from '../components/ui.js';
import type { PlanResult } from '../shared/types.js';

function utilisationTone(value: number) {
  if (value > 1.05) return 'danger' as const;
  if (value > 0.9) return 'warn' as const;
  if (value < 0.4) return 'muted' as const;
  return 'ok' as const;
}

export default function PlanPreview({
  plan,
  summary,
  busy,
  error,
  onApprove,
  onDiscard,
  approveLabel = 'Approve & save plan',
}: {
  plan: PlanResult;
  summary?: string;
  busy?: boolean;
  error?: string | null;
  onApprove: () => void;
  onDiscard: () => void;
  approveLabel?: string;
}) {
  const topLevel = plan.tasks.filter((task) => !task.parent_key);
  const children = (parentKey: string) => plan.tasks.filter((task) => task.parent_key === parentKey);

  return (
    <div className="stack">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Alert tone="info">
        This is a proposal. Nothing has been assigned yet — review it, then approve to write the tasks, deadlines and
        milestones into the project.
      </Alert>

      <div className="grid grid--stats">
        <div className="stat">
          <span className="stat__label">Tasks</span>
          <span className="stat__value">{plan.totals.task_count}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Estimated work</span>
          <span className="stat__value">{Math.round(plan.totals.estimated_hours)}h</span>
        </div>
        <div className="stat">
          <span className="stat__label">Team capacity</span>
          <span className="stat__value">{Math.round(plan.totals.capacity_hours)}h</span>
        </div>
        <div className="stat">
          <span className="stat__label">Working days</span>
          <span className="stat__value">{plan.totals.working_days}</span>
        </div>
      </div>

      {summary ? <p className="small muted">{summary}</p> : null}

      <section className="stack stack--sm">
        <h3 style={{ margin: 0 }}>Workload balance</h3>
        {plan.loads.map((load) => (
          <div key={load.member_id} className="member-row">
            <div className="member-row__main">
              <div className="row row--between">
                <strong>{load.display_name}</strong>
                <span className="small muted mono-num">
                  {Math.round(load.assigned_hours * 10) / 10}h / {Math.round(load.capacity_hours)}h
                </span>
              </div>
              <Progress value={load.utilization * 100} tone={utilisationTone(load.utilization)} />
              <div className="row row--between small muted">
                <span>
                  {load.task_count} task{load.task_count === 1 ? '' : 's'} · {Math.round(load.skill_match_pct)}% skill
                  match
                </span>
                <Badge tone={utilisationTone(load.utilization)}>{load.status.replace('_', ' ')}</Badge>
              </div>
            </div>
          </div>
        ))}
      </section>

      {plan.flags.length > 0 ? (
        <section className="stack stack--sm">
          <h3 style={{ margin: 0 }}>Fairness notes</h3>
          {plan.flags.map((flag, index) => (
            <Alert key={`${flag.member_name}-${index}`} tone={flag.severity === 'high' ? 'error' : flag.severity === 'warning' ? 'warn' : 'info'}>
              <strong>{flag.member_name}:</strong> {flag.message}
            </Alert>
          ))}
        </section>
      ) : (
        <Alert tone="ok">Every member is inside a reasonable share of their available hours.</Alert>
      )}

      <section className="stack stack--sm">
        <h3 style={{ margin: 0 }}>Proposed tasks</h3>
        {topLevel.map((task) => (
          <div key={task.key} className="task-row task-row--group">
            <div className="stack stack--sm" style={{ flex: 1 }}>
              <div className="row row--between">
                <strong>{task.title}</strong>
                <span className="small muted mono-num">{task.estimated_hours}h</span>
              </div>
              {task.description ? <span className="small muted">{task.description}</span> : null}
              <div className="row small muted" style={{ flexWrap: 'wrap', gap: 6 }}>
                <Badge tone="muted">{task.phase}</Badge>
                <span>{task.assignee_name ?? 'Unassigned'}</span>
                {task.start_date ? <span>· {task.start_date} → {task.due_date}</span> : null}
                {task.at_risk ? <Badge tone="warn">tight deadline</Badge> : null}
              </div>
              {children(task.key).map((subtask) => (
                <div key={subtask.key} className="row row--between small" style={{ paddingLeft: 12 }}>
                  <span>
                    ↳ {subtask.title}{' '}
                    <span className="muted">
                      ({subtask.assignee_name ?? 'Unassigned'}, {subtask.estimated_hours}h)
                    </span>
                  </span>
                  {subtask.at_risk ? <Badge tone="warn">tight</Badge> : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="stack stack--sm">
        <h3 style={{ margin: 0 }}>Timeline & checkpoints</h3>
        {plan.timeline.map((entry, index) => (
          <div key={`${entry.title}-${index}`} className="task-row">
            <div className="row row--between" style={{ flex: 1 }}>
              <div className="stack stack--sm">
                <strong>{entry.title}</strong>
                <span className="small muted">{entry.description}</span>
              </div>
              <div className="stack stack--sm" style={{ alignItems: 'flex-end' }}>
                <Badge tone={entry.kind === 'submission' ? 'brand' : entry.kind === 'testing' ? 'warn' : 'muted'}>
                  {entry.kind}
                </Badge>
                <span className="small muted mono-num">{entry.due_date}</span>
              </div>
            </div>
          </div>
        ))}
      </section>

      {plan.assumptions.length > 0 ? (
        <section className="stack stack--sm">
          <h3 style={{ margin: 0 }}>Assumptions</h3>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            {plan.assumptions.map((assumption, index) => (
              <li key={index}>{assumption}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="ghost" onClick={onDiscard} disabled={busy}>
          Discard
        </Button>
        <Button variant="primary" onClick={onApprove} loading={busy}>
          {approveLabel}
        </Button>
      </div>
    </div>
  );
}
