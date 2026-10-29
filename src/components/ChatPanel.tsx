import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, CardHead, EmptyState, Modal, Spinner, TextArea } from './ui.js';
import { useAuth } from '../auth/AuthProvider.js';
import { requestChatSummary, type ChatSummaryResponse } from '../lib/api.js';
import { fail, type ProjectBundle } from '../lib/data.js';
import { supabase } from '../lib/supabase.js';
import { todayISO } from '../shared/dates.js';
import type { ChatMessage } from '../shared/types.js';

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function ChatPanel({
  bundle,
  aiConfigured,
  onTasksAdded,
}: {
  bundle: ProjectBundle;
  aiConfigured: boolean;
  onTasksAdded: () => Promise<void>;
}) {
  const { user } = useAuth();
  const { project, members, me } = bundle;
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<ChatSummaryResponse | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [savingTasks, setSavingTasks] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const nameById = useMemo(() => new Map(members.map((member) => [member.id, member.display_name])), [members]);

  useEffect(() => {
    let active = true;

    supabase()
      .from('messages')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: true })
      .limit(300)
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) {
          setError(loadError.message);
          setMessages([]);
          return;
        }
        setMessages((data ?? []) as ChatMessage[]);
      });

    const channel = supabase()
      .channel(`messages:${project.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `project_id=eq.${project.id}` },
        (payload) => {
          const incoming = payload.new as ChatMessage;
          setMessages((current) => {
            if (!current) return [incoming];
            if (current.some((message) => message.id === incoming.id)) return current;
            return [...current, incoming];
          });
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase().removeChannel(channel);
    };
  }, [project.id]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      const { error: insertError } = await supabase().from('messages').insert({
        project_id: project.id,
        sender_user_id: user!.id,
        sender_member_id: me?.id ?? null,
        sender_name: me?.display_name ?? 'Teammate',
        body,
      });
      if (insertError) fail(insertError, 'Message not sent');
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Message not sent');
    } finally {
      setSending(false);
    }
  }

  async function summarize() {
    setSummaryBusy(true);
    setSummaryError(null);
    try {
      const result = await requestChatSummary(project.id);
      setSummary(result);
      setSelected(Object.fromEntries(result.action_items.map((_, index) => [index, true])));
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Could not summarise the chat.');
    } finally {
      setSummaryBusy(false);
    }
  }

  async function saveSuggestedTasks() {
    if (!summary) return;
    const chosen = summary.action_items.filter((_, index) => selected[index]);
    if (chosen.length === 0) {
      setSummaryError('Select at least one suggested task.');
      return;
    }
    setSavingTasks(true);
    setSummaryError(null);
    try {
      const rows = chosen.map((item, index) => ({
        project_id: project.id,
        title: item.title,
        description: item.description,
        estimated_hours: item.estimated_hours,
        complexity: item.complexity,
        required_skills: [],
        status: 'todo' as const,
        assignee_member_id: item.owner_hint
          ? members.find((member) => member.display_name.toLowerCase() === item.owner_hint!.toLowerCase())?.id ?? null
          : null,
        due_date: project.deadline,
        start_date: todayISO(),
        sort_order: 1000 + index,
        source: 'chat' as const,
        phase: 'From chat',
      }));
      const { error: insertError } = await supabase().from('tasks').insert(rows);
      if (insertError) fail(insertError, 'Could not save the suggested tasks');

      const { error: statusError } = await supabase()
        .from('ai_suggestions')
        .update({ status: 'applied' })
        .eq('id', summary.suggestion_id);
      if (statusError) fail(statusError, 'Tasks saved, but the summary could not be marked as applied');

      setSummary(null);
      await onTasksAdded();
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Could not save the suggested tasks.');
    } finally {
      setSavingTasks(false);
    }
  }

  const rows = messages ?? [];
  let lastDay = '';

  return (
    <div className="stack">
      <Card>
        <CardHead
          title="Team chat"
          subtitle={`${members.length} member${members.length === 1 ? '' : 's'} · messages are visible only to this project's team`}
          actions={
            <Button size="sm" onClick={summarize} loading={summaryBusy} disabled={!aiConfigured || rows.length === 0}>
              Summarise with AI
            </Button>
          }
        />
        <div className="card__body card__body--tight">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {summaryError ? <Alert tone="warn">{summaryError}</Alert> : null}
          {!aiConfigured ? (
            <Alert tone="info">
              Chat works without AI. Set <code>GEMINI_API_KEY</code> on the server to enable summaries and suggested
              tasks.
            </Alert>
          ) : null}

          <div className="chat">
            <div className="chat__list" ref={listRef}>
              {messages === null ? (
                <Spinner label="Loading messages…" />
              ) : rows.length === 0 ? (
                <EmptyState title="No messages yet">
                  <span className="small muted">Say hello and agree who starts which task.</span>
                </EmptyState>
              ) : (
                rows.map((message) => {
                  const mine = message.sender_user_id === user?.id;
                  const day = dayLabel(message.created_at);
                  const showDay = day !== lastDay;
                  lastDay = day;
                  return (
                    <div key={message.id} className="stack stack--sm" style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
                      {showDay ? <div className="chat__day">{day}</div> : null}
                      <div className={`bubble ${mine ? 'bubble--mine' : ''}`}>
                        <div className="bubble__meta">
                          <strong>{mine ? 'You' : message.sender_name || nameById.get(message.sender_member_id ?? '') || 'Teammate'}</strong>
                          <span>{timeLabel(message.created_at)}</span>
                        </div>
                        <span style={{ whiteSpace: 'pre-wrap' }}>{message.body}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="chat__compose">
              <TextArea
                rows={2}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Message your team… (Enter to send, Shift+Enter for a new line)"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <Button variant="primary" onClick={send} loading={sending} disabled={!draft.trim()}>
                Send
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Modal
        open={Boolean(summary)}
        title="AI chat summary"
        wide
        onClose={() => setSummary(null)}
        footer={
          <div className="row" style={{ justifyContent: 'space-between', width: '100%', gap: 8 }}>
            <span className="small muted">Nothing is saved until you confirm.</span>
            <div className="row">
              <Button variant="ghost" onClick={() => setSummary(null)}>
                Close
              </Button>
              <Button variant="primary" onClick={saveSuggestedTasks} loading={savingTasks}>
                Add selected tasks
              </Button>
            </div>
          </div>
        }
      >
        {summary ? (
          <div className="stack">
            <Alert tone="info">
              Generated from the most recent messages. Review the wording — AI summaries can miss context.
            </Alert>
            <div className="stack stack--sm">
              <strong>Summary</strong>
              <p className="small" style={{ margin: 0 }}>{summary.summary}</p>
            </div>

            {summary.decisions.length > 0 ? (
              <div className="stack stack--sm">
                <strong>Decisions</strong>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  {summary.decisions.map((decision, index) => (
                    <li key={index}>{decision}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {summary.open_questions.length > 0 ? (
              <div className="stack stack--sm">
                <strong>Open questions</strong>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  {summary.open_questions.map((question, index) => (
                    <li key={index}>{question}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="stack stack--sm">
              <strong>Suggested tasks</strong>
              {summary.action_items.length === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>The AI did not find any new tasks in this discussion.</p>
              ) : (
                summary.action_items.map((item, index) => (
                  <label key={index} className="task-row" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(selected[index])}
                      onChange={(event) => setSelected((current) => ({ ...current, [index]: event.target.checked }))}
                      style={{ marginRight: 10, marginTop: 4 }}
                    />
                    <div className="stack stack--sm" style={{ flex: 1 }}>
                      <div className="row row--between">
                        <strong className="small">{item.title}</strong>
                        <Badge tone="muted">{item.estimated_hours}h</Badge>
                      </div>
                      <span className="small muted">{item.description}</span>
                      {item.owner_hint ? <span className="small muted">Suggested owner: {item.owner_hint}</span> : null}
                    </div>
                  </label>
                ))
              )}
            </div>
            {summaryError ? <Alert tone="error">{summaryError}</Alert> : null}
          </div>
        ) : null}
      </Modal>

      <Card>
        <CardHead title="Why the AI summary needs confirmation" />
        <div className="card__body small muted">
          Chat messages are informal. The summary is produced by Gemini on the server (the API key never reaches the
          browser) and stored as a suggestion — the tasks only become real when you tick them and press “Add selected
          tasks”.
        </div>
      </Card>
    </div>
  );
}
