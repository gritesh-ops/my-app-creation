import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, CardHead, EmptyState, Field, Modal, Spinner, TextInput } from './ui.js';
import { useAuth } from '../auth/AuthProvider.js';
import { fail, type ProjectBundle } from '../lib/data.js';
import { supabase } from '../lib/supabase.js';
import type { Poll, PollOption, PollVote } from '../shared/types.js';

interface SlotDraft {
  starts_at: string;
  duration_minutes: number;
}

const RESPONSES: { value: PollVote['response']; label: string; tone: 'ok' | 'warn' | 'danger' }[] = [
  { value: 'yes', label: 'Available', tone: 'ok' },
  { value: 'maybe', label: 'Maybe', tone: 'warn' },
  { value: 'no', label: 'No', tone: 'danger' },
];

function toLocalInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nextEvening(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(19, 0, 0, 0);
  return toLocalInput(date);
}

export default function PollsPanel({ bundle }: { bundle: ProjectBundle }) {
  const { user } = useAuth();
  const { project, me, members } = bundle;
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [options, setOptions] = useState<PollOption[]>([]);
  const [votes, setVotes] = useState<PollVote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('When can we meet?');
  const [slots, setSlots] = useState<SlotDraft[]>([
    { starts_at: nextEvening(), duration_minutes: 60 },
    { starts_at: nextEvening(), duration_minutes: 60 },
  ]);
  const [saving, setSaving] = useState(false);
  const [busyVote, setBusyVote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: pollRows, error: pollError } = await supabase()
        .from('polls')
        .select('*')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false });
      if (!active) return;
      if (pollError) {
        setError(pollError.message);
        setPolls([]);
        return;
      }
      const list = (pollRows ?? []) as Poll[];
      setPolls(list);
      if (list.length === 0) return;

      const ids = list.map((poll) => poll.id);
      const [{ data: optionRows }, { data: voteRows }] = await Promise.all([
        supabase().from('poll_options').select('*').in('poll_id', ids).order('starts_at'),
        supabase().from('poll_votes').select('*').in('poll_id', ids),
      ]);
      if (!active) return;
      setOptions((optionRows ?? []) as PollOption[]);
      setVotes((voteRows ?? []) as PollVote[]);
    })();
    return () => {
      active = false;
    };
  }, [project.id]);

  async function reload() {
    const { data: pollRows } = await supabase()
      .from('polls')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false });
    const list = (pollRows ?? []) as Poll[];
    setPolls(list);
    if (list.length === 0) {
      setOptions([]);
      setVotes([]);
      return;
    }
    const ids = list.map((poll) => poll.id);
    const [{ data: optionRows }, { data: voteRows }] = await Promise.all([
      supabase().from('poll_options').select('*').in('poll_id', ids).order('starts_at'),
      supabase().from('poll_votes').select('*').in('poll_id', ids),
    ]);
    setOptions((optionRows ?? []) as PollOption[]);
    setVotes((voteRows ?? []) as PollVote[]);
  }

  async function createPoll() {
    const valid = slots.filter((slot) => slot.starts_at);
    if (!title.trim()) {
      setError('Give the poll a title.');
      return;
    }
    if (valid.length < 2) {
      setError('Add at least two time options so people have a choice.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data: poll, error: pollError } = await supabase()
        .from('polls')
        .insert({
          project_id: project.id,
          title: title.trim(),
          description: '',
          created_by: user!.id,
        })
        .select('id')
        .single();
      if (pollError) fail(pollError, 'Could not create the poll');

      const rows = valid.map((slot) => ({
        poll_id: poll.id,
        starts_at: new Date(slot.starts_at).toISOString(),
        duration_minutes: slot.duration_minutes,
      }));
      const { error: optionError } = await supabase().from('poll_options').insert(rows);
      if (optionError) fail(optionError, 'Could not save the time options');

      setOpen(false);
      setSlots([
        { starts_at: nextEvening(), duration_minutes: 60 },
        { starts_at: nextEvening(), duration_minutes: 60 },
      ]);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the poll');
    } finally {
      setSaving(false);
    }
  }

  async function vote(option: PollOption, response: PollVote['response']) {
    if (!me) {
      setError('Only members of this project can vote.');
      return;
    }
    setBusyVote(option.id);
    setError(null);
    try {
      const { error: voteError } = await supabase()
        .from('poll_votes')
        .upsert(
          {
            poll_id: option.poll_id,
            option_id: option.id,
            member_id: me.id,
            user_id: user!.id,
            response,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'option_id,user_id' },
        );
      if (voteError) fail(voteError, 'Could not record your vote');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your vote');
    } finally {
      setBusyVote(null);
    }
  }

  async function deletePoll(poll: Poll) {
    setError(null);
    const { error: deleteError } = await supabase().from('polls').delete().eq('id', poll.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await reload();
  }

  const myVote = (optionId: string) => votes.find((item) => item.option_id === optionId && item.user_id === user?.id)?.response;

  return (
    <div className="stack">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={() => setOpen(true)}>+ New availability poll</Button>
      </div>

      <Alert tone="info">
        Polls organise meetings. TeamPilot does not create calendar events or send push notifications — this is a
        coordination tool, and everyone sees the result here.
      </Alert>

      {polls === null ? (
        <Spinner label="Loading polls…" />
      ) : polls.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState title="No polls yet">
              <span className="small muted">Create one to find a meeting slot that works for the whole team.</span>
            </EmptyState>
          </CardBody>
        </Card>
      ) : (
        polls.map((poll) => {
          const pollOptions = options.filter((option) => option.poll_id === poll.id);
          return (
            <Card key={poll.id}>
              <CardHead
                title={poll.title}
                subtitle={`Created ${new Date(poll.created_at).toLocaleDateString()}${
                  me && poll.created_by === user?.id ? ' · by you' : ''
                }`}
                actions={
                  me && poll.created_by === user?.id ? (
                    <Button variant="ghost" size="sm" onClick={() => deletePoll(poll)}>
                      Delete
                    </Button>
                  ) : undefined
                }
              />
              <div className="card__body stack">
                {pollOptions.map((option) => {
                  const optionVotes = votes.filter((voteRow) => voteRow.option_id === option.id);
                  const yes = optionVotes.filter((voteRow) => voteRow.response === 'yes').length;
                  const maybe = optionVotes.filter((voteRow) => voteRow.response === 'maybe').length;
                  const mine = myVote(option.id);
                  return (
                    <div key={option.id} className="task-row">
                      <div className="stack stack--sm" style={{ flex: 1 }}>
                        <div className="row row--between" style={{ flexWrap: 'wrap', gap: 8 }}>
                          <strong className="small">
                            {new Date(option.starts_at).toLocaleString([], {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            <span className="muted"> · {option.duration_minutes} min</span>
                          </strong>
                          <div className="row" style={{ gap: 6 }}>
                            <Badge tone="ok">{yes} yes</Badge>
                            {maybe > 0 ? <Badge tone="warn">{maybe} maybe</Badge> : null}
                            <Badge tone="muted">{optionVotes.length}/{members.length} voted</Badge>
                          </div>
                        </div>
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          {RESPONSES.map((response) => (
                            <Button
                              key={response.value}
                              size="sm"
                              variant={mine === response.value ? 'primary' : 'ghost'}
                              disabled={busyVote === option.id}
                              onClick={() => vote(option, response.value)}
                            >
                              {response.label}
                            </Button>
                          ))}
                        </div>
                        {optionVotes.length > 0 ? (
                          <span className="small muted">
                            {optionVotes
                              .map((voteRow) => {
                                const member = members.find((item) => item.id === voteRow.member_id);
                                return `${member?.display_name ?? 'Member'}: ${voteRow.response}`;
                              })
                              .join(' · ')}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })
      )}

      <Modal
        open={open}
        title="New availability poll"
        onClose={() => setOpen(false)}
        footer={
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createPoll} loading={saving}>
              Create poll
            </Button>
          </div>
        }
      >
        <div className="stack">
          <Field label="Question">
            <TextInput value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          {slots.map((slot, index) => (
            <div key={index} className="form-grid">
              <Field label={`Option ${index + 1}`}>
                <TextInput
                  type="datetime-local"
                  value={slot.starts_at}
                  onChange={(event) =>
                    setSlots((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, starts_at: event.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Minutes">
                <TextInput
                  type="number"
                  min={15}
                  max={480}
                  step={15}
                  value={slot.duration_minutes}
                  onChange={(event) =>
                    setSlots((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, duration_minutes: Number(event.target.value) } : item,
                      ),
                    )
                  }
                />
              </Field>
            </div>
          ))}
          <div className="row" style={{ gap: 8 }}>
            <Button
              size="sm"
              onClick={() =>
                setSlots((current) => [...current, { starts_at: nextEvening(), duration_minutes: 60 }])
              }
              disabled={slots.length >= 5}
            >
              + Add option
            </Button>
            {slots.length > 2 ? (
              <Button size="sm" variant="ghost" onClick={() => setSlots((current) => current.slice(0, -1))}>
                Remove last
              </Button>
            ) : null}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="card__body">{children}</div>;
}
