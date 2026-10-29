import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ChatPanel from '../components/ChatPanel.js';
import MembersPanel from '../components/MembersPanel.js';
import PlanPreview from '../components/PlanPreview.js';
import PollsPanel from '../components/PollsPanel.js';
import ProjectOverview from '../components/ProjectOverview.js';
import TasksPanel from '../components/TasksPanel.js';
import TimelinePanel from '../components/TimelinePanel.js';
import { Alert, Badge, Button, Card, CardHead, Spinner } from '../components/ui.js';
import { requestPlan, type PlanResponse } from '../lib/api.js';
import { applyPlanSuggestion, dismissSuggestion, loadProjectBundle, type ProjectBundle } from '../lib/data.js';
import { supabase } from '../lib/supabase.js';
import type { AiSuggestion, PlanResult } from '../shared/types.js';

type TabKey = 'overview' | 'tasks' | 'timeline' | 'team' | 'chat' | 'polls';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'team', label: 'Team' },
  { key: 'chat', label: 'Chat' },
  { key: 'polls', label: 'Polls' },
];

export default function ProjectPage({ aiConfigured }: { aiConfigured: boolean }) {
  const { projectId } = useParams<{ projectId: string }>();
  const [bundle, setBundle] = useState<ProjectBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const next = await loadProjectBundle(projectId);
    setBundle(next);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loadProjectBundle(projectId!)
      .then((next) => {
        if (active) setBundle(next);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load this project.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  /** A pending plan lives in ai_suggestions; show it again after a reload. */
  useEffect(() => {
    if (!bundle || bundle.project.plan_status !== 'proposed') return;
    let active = true;
    supabase()
      .from('ai_suggestions')
      .select('*')
      .eq('project_id', bundle.project.id)
      .eq('kind', 'plan')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        const suggestion = data as AiSuggestion;
        const payload = suggestion.payload as { plan?: PlanResult; assumptions?: string[]; model?: string } | null;
        if (!payload?.plan) return;
        setPlan({
          suggestion_id: suggestion.id,
          created_at: suggestion.created_at,
          summary: suggestion.summary,
          plan: payload.plan,
          assumptions: payload.assumptions ?? [],
          model: payload.model ?? 'gemini',
        });
      });
    return () => {
      active = false;
    };
  }, [bundle]);

  async function generatePlan() {
    if (!bundle) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      const response = await requestPlan(bundle.project.id);
      setPlan(response);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Could not generate the plan.');
    } finally {
      setPlanBusy(false);
    }
  }

  async function approvePlan() {
    if (!plan) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      await applyPlanSuggestion(plan.suggestion_id);
      setPlan(null);
      await refresh();
      setTab('tasks');
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Could not save the plan.');
    } finally {
      setPlanBusy(false);
    }
  }

  async function discardPlan() {
    if (!plan) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      await dismissSuggestion(plan.suggestion_id);
      setPlan(null);
      await refresh();
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Could not discard the plan.');
    } finally {
      setPlanBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading project…" />;

  if (error || !bundle) {
    return (
      <Card>
        <CardHead title="Project unavailable" />
        <div className="card__body stack">
          <Alert tone="error">{error ?? 'This project could not be loaded.'}</Alert>
          <p className="small muted" style={{ margin: 0 }}>
            Projects are private. If a teammate invited you, sign in with the email address they used and claim the
            invite from the Team tab.
          </p>
          <Link to="/">
            <Button>Back to projects</Button>
          </Link>
        </div>
      </Card>
    );
  }

  const { project, members } = bundle;
  const daysLeft = Math.max(0, Math.round((Date.parse(project.deadline) - Date.now()) / 86400000));

  return (
    <div className="stack">
      <div className="page-head">
        <div className="page-head__text">
          <Link to="/" className="small muted">
            ← All projects
          </Link>
          <h1>{project.name}</h1>
          <p className="page-head__sub">
            {project.subject} · deadline {project.deadline} ({daysLeft} day{daysLeft === 1 ? '' : 's'} left) ·{' '}
            {members.length} member{members.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Badge tone={project.plan_status === 'approved' ? 'ok' : project.plan_status === 'proposed' ? 'warn' : 'muted'}>
            plan {project.plan_status}
          </Badge>
          <Badge tone="muted">{project.status}</Badge>
        </div>
      </div>

      {planError ? <Alert tone="error">{planError}</Alert> : null}

      <nav className="tabbar" aria-label="Project sections">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`tab ${tab === item.key ? 'tab--active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? (
        <ProjectOverview
          bundle={bundle}
          onOpenTasks={() => setTab('tasks')}
          onGeneratePlan={generatePlan}
          generating={planBusy}
        />
      ) : null}

      {tab === 'tasks' ? <TasksPanel bundle={bundle} onChanged={refresh} /> : null}
      {tab === 'timeline' ? <TimelinePanel bundle={bundle} onChanged={refresh} /> : null}
      {tab === 'team' ? <MembersPanel bundle={bundle} onChanged={refresh} /> : null}
      {tab === 'chat' ? <ChatPanel bundle={bundle} aiConfigured={aiConfigured} onTasksAdded={async () => { await refresh(); setTab('tasks'); }} /> : null}
      {tab === 'polls' ? <PollsPanel bundle={bundle} /> : null}

      {plan ? (
        <PlanPreview
          plan={plan.plan}
          summary={plan.summary}
          busy={planBusy}
          error={planError}
          onApprove={approvePlan}
          onDiscard={discardPlan}
        />
      ) : null}
    </div>
  );
}
