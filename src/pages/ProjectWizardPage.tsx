import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, CardHead, Field, Select, TextArea, TextInput } from '../components/ui.js';
import PlanPreview from '../components/PlanPreview.js';
import { useAuth } from '../auth/AuthProvider.js';
import { requestPlan, type PlanResponse } from '../lib/api.js';
import { applyPlanSuggestion, dismissSuggestion, fail } from '../lib/data.js';
import { supabase } from '../lib/supabase.js';
import type { Experience, Project } from '../shared/types.js';

interface DraftMember {
  key: string;
  email: string;
  display_name: string;
  skills: string;
  experience: Experience;
  hours_per_week: number;
}

const today = () => new Date().toISOString().slice(0, 10);

function blankMember(): DraftMember {
  return {
    key: crypto.randomUUID(),
    email: '',
    display_name: '',
    skills: '',
    experience: 'intermediate',
    hours_per_week: 8,
  };
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function ProjectWizardPage({ aiConfigured }: { aiConfigured: boolean }) {
  const navigate = useNavigate();
  const { profile, user } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [problem, setProblem] = useState('');
  const [deadline, setDeadline] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [deliverables, setDeliverables] = useState('');

  const [ownerSkills, setOwnerSkills] = useState('');
  const [ownerExperience, setOwnerExperience] = useState<Experience>('intermediate');
  const [ownerHours, setOwnerHours] = useState(8);
  const [members, setMembers] = useState<DraftMember[]>([]);

  const [plan, setPlan] = useState<PlanResponse | null>(null);

  const validateStep1 = useMemo(() => {
    if (!name.trim()) return 'Give the project a name.';
    if (!deadline) return 'Pick the submission deadline.';
    if (deadline < startDate) return 'The deadline must be on or after the start date.';
    if (!problem.trim()) return 'Paste the problem statement so the AI has something to work from.';
    return null;
  }, [name, deadline, startDate, problem]);

  const memberProblems = useMemo(() => {
    return members
      .map((member) => {
        if (!member.email.trim()) return 'Every added teammate needs an email address.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email.trim())) return `"${member.email}" is not a valid email.`;
        if (!member.display_name.trim()) return 'Every added teammate needs a name.';
        if (member.hours_per_week <= 0) return 'Available hours must be greater than zero.';
        return null;
      })
      .filter((value): value is string => Boolean(value));
  }, [members]);

  const duplicateEmails = useMemo(() => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    members.forEach((member) => {
      const email = member.email.trim().toLowerCase();
      if (!email) return;
      if (seen.has(email)) duplicates.push(email);
      seen.add(email);
    });
    return duplicates;
  }, [members]);

  function updateMember(key: string, patch: Partial<DraftMember>) {
    setMembers((current) => current.map((member) => (member.key === key ? { ...member, ...patch } : member)));
  }

  /** Create the project + memberships once, then reuse the id on retries. */
  async function persistProject(): Promise<string> {
    if (projectId) {
      await updateMemberships(projectId);
      return projectId;
    }

    const { data, error: insertError } = await supabase()
      .from('projects')
      .insert({
        owner_id: user!.id,
        name: name.trim(),
        subject: subject.trim(),
        problem_statement: problem.trim(),
        deliverables: splitList(deliverables),
        deadline,
        start_date: startDate,
      })
      .select('*')
      .single();
    if (insertError || !data) fail(insertError, 'Could not create the project');

    const project = data as Project;
    await updateMemberships(project.id);
    setProjectId(project.id);
    return project.id;
  }

  async function updateMemberships(id: string) {
    // The database created the owner row automatically; fill in their details.
    const { error: ownerError } = await supabase()
      .from('project_members')
      .update({
        display_name: profile?.full_name || user?.email?.split('@')[0] || 'Owner',
        skills: splitList(ownerSkills),
        experience: ownerExperience,
        hours_per_week: ownerHours,
        invite_status: 'accepted',
      })
      .eq('project_id', id)
      .eq('user_id', user!.id);
    if (ownerError) fail(ownerError, 'Could not save your own details');

    if (members.length === 0) return;

    const rows = members.map((member) => ({
      project_id: id,
      email: member.email.trim().toLowerCase(),
      display_name: member.display_name.trim(),
      skills: splitList(member.skills),
      experience: member.experience,
      hours_per_week: member.hours_per_week,
      role: 'member' as const,
      invite_status: 'invited' as const,
    }));

    const { error: memberError } = await supabase()
      .from('project_members')
      .upsert(rows, { onConflict: 'project_id,email', ignoreDuplicates: false });
    if (memberError) fail(memberError, 'Could not save the team list');
  }

  async function goToTeam() {
    if (validateStep1) return;
    setStep(2);
  }

  async function generatePlan() {
    if (memberProblems.length > 0) {
      setError(memberProblems[0]);
      return;
    }
    if (duplicateEmails.length > 0) {
      setError(`The same email is used twice: ${duplicateEmails.join(', ')}.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const id = await persistProject();
      const response = await requestPlan(id);
      setPlan(response);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the plan.');
    } finally {
      setBusy(false);
    }
  }

  async function saveWithoutAi() {
    if (memberProblems.length > 0) {
      setError(memberProblems[0]);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const id = await persistProject();
      navigate(`/projects/${id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the project.');
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!plan || !projectId) return;
    setError(null);
    setBusy(true);
    try {
      await applyPlanSuggestion(plan.suggestion_id);
      navigate(`/projects/${projectId}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the plan.');
    } finally {
      setBusy(false);
    }
  }

  async function discardPlan() {
    if (!plan || !projectId) return;
    setBusy(true);
    try {
      await dismissSuggestion(plan.suggestion_id);
      navigate(`/projects/${projectId}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not discard the plan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div className="page-head__text">
          <h1>New project</h1>
          <p className="page-head__sub">Step {step} of 3 · {step === 1 ? 'Project brief' : step === 2 ? 'Team & availability' : 'Review the plan'}</p>
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {step === 1 ? (
        <Card>
          <CardHead title="What is the project?" subtitle="The AI uses the problem statement, deliverable list and deadline." />
          <div className="card__body stack">
            <div className="form-grid">
              <Field label="Project name" full>
                <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Campus lost-and-found app" />
              </Field>
              <Field label="Subject / course">
                <TextInput value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="CS-301 Software Engineering" />
              </Field>
              <Field label="Start date">
                <TextInput type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </Field>
              <Field label="Submission deadline" full>
                <TextInput type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
              </Field>
              <Field label="Problem statement" hint="Paste the full brief your professor gave you." full>
                <TextArea
                  rows={7}
                  value={problem}
                  onChange={(event) => setProblem(event.target.value)}
                  placeholder="Students lose items on campus and have no central place to report or claim them. Build a web app where…"
                />
              </Field>
              <Field label="Deliverables" hint="One per line, or comma separated." full>
                <TextArea
                  rows={4}
                  value={deliverables}
                  onChange={(event) => setDeliverables(event.target.value)}
                  placeholder={'Source code repository\nDesign document\nFinal report (PDF)\nDemo video'}
                />
              </Field>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Button variant="primary" onClick={goToTeam} disabled={Boolean(validateStep1)}>
                Next: team →
              </Button>
            </div>
            {validateStep1 ? <p className="small muted">{validateStep1}</p> : null}
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <div className="stack">
          <Card>
            <CardHead title="You" subtitle="Your own skills and weekly availability are used for balancing." />
            <div className="card__body">
              <div className="form-grid">
                <Field label="Your skills" hint="Comma separated, e.g. React, UI design">
                  <TextInput value={ownerSkills} onChange={(event) => setOwnerSkills(event.target.value)} />
                </Field>
                <Field label="Experience level">
                  <Select value={ownerExperience} onChange={(event) => setOwnerExperience(event.target.value as Experience)}>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </Select>
                </Field>
                <Field label="Hours available per week">
                  <TextInput
                    type="number"
                    min={1}
                    max={80}
                    value={ownerHours}
                    onChange={(event) => setOwnerHours(Number(event.target.value))}
                  />
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <CardHead
              title="Teammates"
              subtitle="They join by signing in with the email you enter — no invites are sent automatically."
              actions={
                <Button size="sm" onClick={() => setMembers((current) => [...current, blankMember()])}>
                  + Add member
                </Button>
              }
            />
            <div className="card__body stack">
              {members.length === 0 ? (
                <p className="small muted">Working solo? You can continue with just yourself, but a group project usually needs at least two people.</p>
              ) : null}

              {members.map((member, index) => (
                <div key={member.key} className="member-editor stack stack--sm">
                  <div className="row row--between">
                    <strong>Teammate {index + 1}</strong>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setMembers((current) => current.filter((item) => item.key !== member.key))}
                    >
                      Remove
                    </Button>
                  </div>
                  <div className="form-grid">
                    <Field label="Email">
                      <TextInput
                        type="email"
                        value={member.email}
                        onChange={(event) => updateMember(member.key, { email: event.target.value })}
                        placeholder="teammate@college.edu"
                      />
                    </Field>
                    <Field label="Name">
                      <TextInput
                        value={member.display_name}
                        onChange={(event) => updateMember(member.key, { display_name: event.target.value })}
                        placeholder="Priya"
                      />
                    </Field>
                    <Field label="Skills" hint="Comma separated">
                      <TextInput
                        value={member.skills}
                        onChange={(event) => updateMember(member.key, { skills: event.target.value })}
                        placeholder="Node.js, testing"
                      />
                    </Field>
                    <Field label="Experience">
                      <Select
                        value={member.experience}
                        onChange={(event) => updateMember(member.key, { experience: event.target.value as Experience })}
                      >
                        <option value="beginner">Beginner</option>
                        <option value="intermediate">Intermediate</option>
                        <option value="advanced">Advanced</option>
                      </Select>
                    </Field>
                    <Field label="Hours per week">
                      <TextInput
                        type="number"
                        min={1}
                        max={80}
                        value={member.hours_per_week}
                        onChange={(event) => updateMember(member.key, { hours_per_week: Number(event.target.value) })}
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <Button variant="ghost" onClick={() => setStep(1)}>
              ← Back
            </Button>
            <div className="row">
              <Button onClick={saveWithoutAi} loading={busy}>
                Save without AI
              </Button>
              <Button variant="primary" onClick={generatePlan} loading={busy} disabled={!aiConfigured}>
                {plan ? 'Regenerate plan' : 'Generate plan with AI'}
              </Button>
            </div>
          </div>

          {!aiConfigured ? (
            <Alert tone="warn">
              The AI planner is switched off on this server (no <code>GEMINI_API_KEY</code>). You can still save the
              project and add tasks by hand from the project page.
            </Alert>
          ) : (
            <p className="small muted">
              The AI reads your brief, then a deterministic scheduler splits the hours by skill, availability and
              dependencies. You will see the full proposal before anything is saved.
            </p>
          )}
        </div>
      ) : null}

      {step === 3 && plan ? <PlanPreview plan={plan.plan} summary={plan.summary} busy={busy} error={error} onApprove={approve} onDiscard={discardPlan} /> : null}
    </div>
  );
}
