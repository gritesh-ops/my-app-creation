import { useState } from 'react';
import { Badge, Button, Card, CardHead, Field, Modal, Select, TextArea, TextInput } from './ui.js';
import { fail, type ProjectBundle } from '../lib/data.js';
import { supabase } from '../lib/supabase.js';
import { todayISO } from '../shared/dates.js';
import type { Milestone } from '../shared/types.js';

const KIND_LABEL: Record<Milestone['kind'], string> = {
  milestone: 'Milestone',
  testing: 'Testing window',
  submission: 'Submission prep',
};

function kindTone(kind: Milestone['kind']) {
  if (kind === 'submission') return 'brand' as const;
  if (kind === 'testing') return 'warn' as const;
  return 'muted' as const;
}

export default function TimelinePanel({ bundle, onChanged }: { bundle: ProjectBundle; onChanged: () => Promise<void> }) {
  const { milestones, tasks, project } = bundle;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(project.deadline);
  const [kind, setKind] = useState<Milestone['kind']>('milestone');

  const today = todayISO();
  const sorted = [...milestones].sort((a, b) => a.due_date.localeCompare(b.due_date));

  const phases = Array.from(
    tasks.reduce((map, task) => {
      const phase = task.phase || 'General';
      const current = map.get(phase) ?? { hours: 0, done: 0, count: 0, earliest: null as string | null, latest: null as string | null };
      current.hours += Number(task.estimated_hours || 0);
      current.count += 1;
      if (task.status === 'done') current.done += Number(task.estimated_hours || 0);
      if (task.start_date && (!current.earliest || task.start_date < current.earliest)) current.earliest = task.start_date;
      if (task.due_date && (!current.latest || task.due_date > current.latest)) current.latest = task.due_date;
      map.set(phase, current);
      return map;
    }, new Map<string, { hours: number; done: number; count: number; earliest: string | null; latest: string | null }>()),
  );

  async function addMilestone() {
    if (!title.trim()) {
      setError('Give the checkpoint a title.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: insertError } = await supabase().from('milestones').insert({
        project_id: project.id,
        title: title.trim(),
        description: description.trim(),
        due_date: dueDate,
        kind,
        sort_order: milestones.length + 1,
      });
      if (insertError) fail(insertError, 'Could not add the checkpoint');
      setOpen(false);
      setTitle('');
      setDescription('');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the checkpoint');
    } finally {
      setSaving(false);
    }
  }

  async function removeMilestone(milestone: Milestone) {
    setError(null);
    const { error: deleteError } = await supabase().from('milestones').delete().eq('id', milestone.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await onChanged();
  }

  return (
    <div className="stack">
      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={() => setOpen(true)}>+ Add checkpoint</Button>
      </div>

      <Card>
        <CardHead
          title="Timeline"
          subtitle={`${project.start_date} → ${project.deadline}. Dates come from the approved plan; adjust them as your team learns more.`}
        />
        <div className="card__body stack">
          {sorted.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              No checkpoints yet. Approving an AI plan creates milestone, testing and submission-preparation checkpoints
              automatically.
            </p>
          ) : (
            sorted.map((milestone) => (
              <div key={milestone.id} className="task-row">
                <div className="row row--between" style={{ flex: 1, gap: 8 }}>
                  <div className="stack stack--sm">
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <strong>{milestone.title}</strong>
                      <Badge tone={kindTone(milestone.kind)}>{KIND_LABEL[milestone.kind]}</Badge>
                      {milestone.due_date < today ? <Badge tone="danger">passed</Badge> : null}
                    </div>
                    {milestone.description ? <span className="small muted">{milestone.description}</span> : null}
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="small mono-num muted">{milestone.due_date}</span>
                    <Button variant="ghost" size="sm" onClick={() => removeMilestone(milestone)}>
                      ✕
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card>
        <CardHead title="Work by phase" subtitle="Hours completed against hours planned in each phase." />
        <div className="card__body stack">
          {phases.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>No tasks yet.</p>
          ) : (
            phases.map(([phase, info]) => (
              <div key={phase} className="row row--between small">
                <span>{phase}</span>
                <span className="muted mono-num">
                  {Math.round(info.done)}/{Math.round(info.hours)}h · {info.count} task{info.count === 1 ? '' : 's'}
                  {info.earliest && info.latest ? ` · ${info.earliest} → ${info.latest}` : ''}
                </span>
              </div>
            ))
          )}
        </div>
      </Card>

      <Modal
        open={open}
        title="Add a checkpoint"
        onClose={() => setOpen(false)}
        footer={
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={addMilestone} loading={saving}>
              Save checkpoint
            </Button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Title" full>
            <TextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Draft report review" />
          </Field>
          <Field label="Details" full>
            <TextArea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label="Due date">
            <TextInput type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
          <Field label="Type">
            <Select value={kind} onChange={(event) => setKind(event.target.value as Milestone['kind'])}>
              <option value="milestone">Milestone</option>
              <option value="testing">Testing window</option>
              <option value="submission">Submission prep</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
