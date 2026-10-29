import { useState } from 'react';
import { Badge, Button, Card, CardHead, Field, Modal, Select, TextArea, TextInput } from './ui.js';
import { fail, type ProjectBundle } from '../lib/data.js';
import { supabase } from '../lib/supabase.js';
import { todayISO } from '../shared/dates.js';
import type { Task, TaskStatus } from '../shared/types.js';

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

function statusTone(status: TaskStatus) {
  if (status === 'done') return 'ok' as const;
  if (status === 'blocked') return 'danger' as const;
  if (status === 'in_progress') return 'brand' as const;
  return 'muted' as const;
}

export default function TasksPanel({ bundle, onChanged }: { bundle: ProjectBundle; onChanged: () => Promise<void> }) {
  const { tasks, members, project, me } = bundle;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newHours, setNewHours] = useState(2);
  const [newAssignee, setNewAssignee] = useState('');
  const [newDue, setNewDue] = useState(project.deadline);
  const [saving, setSaving] = useState(false);

  const canEdit = Boolean(me);

  const groups = members.map((member) => ({
    member,
    tasks: tasks.filter((task) => task.assignee_member_id === member.id),
  }));
  const unassigned = tasks.filter((task) => !task.assignee_member_id);

  async function updateTask(task: Task, patch: Partial<Task>) {
    setError(null);
    setBusyId(task.id);
    try {
      const { error: updateError } = await supabase().from('tasks').update(patch).eq('id', task.id);
      if (updateError) fail(updateError, 'Could not update the task');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the task');
    } finally {
      setBusyId(null);
    }
  }

  async function addTask() {
    if (!newTitle.trim()) {
      setError('Give the task a title.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: insertError } = await supabase().from('tasks').insert({
        project_id: project.id,
        title: newTitle.trim(),
        description: newDescription.trim(),
        estimated_hours: newHours,
        complexity: 2,
        required_skills: [],
        status: 'todo',
        assignee_member_id: newAssignee || null,
        due_date: newDue || null,
        start_date: todayISO(),
        sort_order: tasks.length + 1,
        source: 'manual',
        phase: 'General',
      });
      if (insertError) fail(insertError, 'Could not add the task');
      setAddOpen(false);
      setNewTitle('');
      setNewDescription('');
      setNewHours(2);
      setNewAssignee('');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the task');
    } finally {
      setSaving(false);
    }
  }

  function renderTask(task: Task, depth = 0) {
    const children = tasks.filter((item) => item.parent_task_id === task.id);
    const late = task.status !== 'done' && task.due_date && task.due_date < todayISO();
    return (
      <div key={task.id} className="stack stack--sm" style={{ paddingLeft: depth * 18 }}>
        <div className="task-row">
          <div className="stack stack--sm" style={{ flex: 1 }}>
            <div className="row row--between" style={{ gap: 8, flexWrap: 'wrap' }}>
              <strong className={task.status === 'done' ? 'muted' : undefined}>{task.title}</strong>
              <div className="row">
                <Badge tone={statusTone(task.status)}>{STATUS_LABEL[task.status]}</Badge>
                {late ? <Badge tone="danger">late</Badge> : null}
              </div>
            </div>
            {task.description ? <span className="small muted">{task.description}</span> : null}
            <div className="row small muted" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span className="mono-num">{Number(task.estimated_hours)}h</span>
              {task.due_date ? <span>due {task.due_date}</span> : <span>no due date</span>}
              {task.phase ? <span className="badge badge--muted">{task.phase}</span> : null}
              {task.source !== 'manual' ? <span>· {task.source === 'ai' ? 'AI planned' : 'from chat'}</span> : null}
            </div>
          </div>

          {canEdit ? (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Select
                value={task.status}
                disabled={busyId === task.id}
                onChange={(event) => updateTask(task, { status: event.target.value as TaskStatus })}
                aria-label={`Status for ${task.title}`}
              >
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Select
                value={task.assignee_member_id ?? ''}
                disabled={busyId === task.id}
                onChange={(event) => updateTask(task, { assignee_member_id: event.target.value || null })}
                aria-label={`Assignee for ${task.title}`}
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.display_name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
        {children.map((child) => renderTask(child, depth + 1))}
      </div>
    );
  }

  const roots = (list: Task[]) => list.filter((task) => !task.parent_task_id);

  return (
    <div className="stack">
      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={() => setAddOpen(true)}>+ Add task manually</Button>
      </div>

      {groups.map(({ member, tasks: memberTasks }) => {
        const hours = memberTasks.reduce((sum, task) => sum + Number(task.estimated_hours || 0), 0);
        const open = memberTasks.filter((task) => task.status !== 'done').length;
        return (
          <Card key={member.id}>
            <CardHead
              title={
                <span className="row">
                  <span className="avatar">{member.display_name.slice(0, 2).toUpperCase()}</span>
                  {member.display_name}
                  {member.role === 'owner' ? <Badge tone="brand">owner</Badge> : null}
                  {member.invite_status !== 'accepted' ? <Badge tone="muted">not joined yet</Badge> : null}
                </span>
              }
              subtitle={`${Math.round(hours * 10) / 10}h assigned · ${open} open · ${member.hours_per_week}h available per week`}
            />
            <div className="card__body stack">
              {roots(memberTasks).length === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>No tasks assigned yet.</p>
              ) : (
                roots(memberTasks).map((task) => renderTask(task))
              )}
            </div>
          </Card>
        );
      })}

      <Card>
        <CardHead title="Unassigned" subtitle="Every task should have an owner before the deadline." />
        <div className="card__body stack">
          {roots(unassigned).length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>Everything has an owner.</p>
          ) : (
            roots(unassigned).map((task) => renderTask(task))
          )}
        </div>
      </Card>

      <Modal
        open={addOpen}
        title="Add a task"
        onClose={() => setAddOpen(false)}
        footer={
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={addTask} loading={saving}>
              Save task
            </Button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Title" full>
            <TextInput value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Write the final report" />
          </Field>
          <Field label="Details" full>
            <TextArea rows={3} value={newDescription} onChange={(event) => setNewDescription(event.target.value)} />
          </Field>
          <Field label="Estimated hours">
            <TextInput
              type="number"
              min={0.5}
              step={0.5}
              value={newHours}
              onChange={(event) => setNewHours(Number(event.target.value))}
            />
          </Field>
          <Field label="Due date">
            <TextInput type="date" value={newDue} onChange={(event) => setNewDue(event.target.value)} />
          </Field>
          <Field label="Assignee" full>
            <Select value={newAssignee} onChange={(event) => setNewAssignee(event.target.value)}>
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.display_name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
