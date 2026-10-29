import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, EmptyState, Progress, Spinner } from '../components/ui.js';
import { loadProjectSummaries, type ProjectSummary } from '../lib/data.js';

function statusTone(status: ProjectSummary['status']) {
  if (status === 'completed') return 'ok' as const;
  if (status === 'active') return 'brand' as const;
  return 'muted' as const;
}

function planLabel(project: ProjectSummary) {
  if (project.plan_status === 'approved') return 'Plan approved';
  if (project.plan_status === 'proposed') return 'Plan waiting for approval';
  return 'No plan yet';
}

export default function ProjectsPage({ aiConfigured }: { aiConfigured: boolean }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadProjectSummaries()
      .then((list) => {
        if (active) setProjects(list);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load projects');
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!projects) return <Spinner label="Loading your projects…" />;

  const active = projects.filter((project) => project.status !== 'completed');
  const done = projects.filter((project) => project.status === 'completed');

  return (
    <div className="stack">
      <div className="page-head">
        <div className="page-head__text">
          <h1>My projects</h1>
          <p className="page-head__sub">
            {projects.length === 0
              ? 'Create your first project to get a plan, a timeline and a team chat.'
              : `${active.length} in progress · ${done.length} completed`}
          </p>
        </div>
        <div className="page-head__actions">
          <Link to="/projects/new">
            <Button variant="primary">+ New project</Button>
          </Link>
        </div>
      </div>

      {!aiConfigured ? (
        <Alert tone="warn">
          <strong>The AI planner is not configured on this server.</strong> Everything else works — you can create a
          project, invite your team, chat in real time and add tasks by hand. To switch on the Gemini planner, set
          <code> GEMINI_API_KEY </code> on the server and restart.
        </Alert>
      ) : null}

      {projects.length === 0 ? (
        <Card>
          <EmptyState title="No projects yet">
            <p className="small muted">
              Start with your problem statement and team list. TeamPilot will draft the task breakdown and a fair
              workload split — you approve it before anything is saved.
            </p>
            <Link to="/projects/new">
              <Button variant="primary">Create your first project</Button>
            </Link>
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid--2">
          {projects.map((project) => {
            const pct = project.task_count > 0 ? (project.done_count / project.task_count) * 100 : 0;
            return (
              <Card key={project.id} className="project-card">
                <Link to={`/projects/${project.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="card__body stack">
                    <div className="row row--between">
                      <div className="stack stack--sm">
                        <strong style={{ fontSize: '1.05rem' }}>{project.name}</strong>
                        <span className="small muted">
                          {project.subject || 'No subject'} · deadline {project.deadline}
                        </span>
                      </div>
                      <Badge tone={statusTone(project.status)}>{project.status}</Badge>
                    </div>

                    <Progress value={pct} tone={project.overdue_count > 0 ? 'warn' : 'brand'} />
                    <div className="row row--between small muted">
                      <span>
                        {project.done_count}/{project.task_count} tasks done
                      </span>
                      <span>
                        {project.member_count} member{project.member_count === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                      <Badge tone={project.plan_status === 'approved' ? 'ok' : 'warn'}>{planLabel(project)}</Badge>
                      {project.overdue_count > 0 ? (
                        <Badge tone="danger">{project.overdue_count} overdue</Badge>
                      ) : null}
                    </div>
                  </div>
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
