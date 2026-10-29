import { useState } from 'react';
import { Badge, Button, Card, CardHead, Field, Modal, TextArea, TextInput } from './ui.js';
import { fail, type ProjectBundle } from '../lib/data.js';
import { supabase } from '../lib/supabase.js';
import type { ProjectMember } from '../shared/types.js';

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function MembersPanel({ bundle, onChanged }: { bundle: ProjectBundle; onChanged: () => Promise<void> }) {
  const { members, me, project } = bundle;
  const [editing, setEditing] = useState<ProjectMember | null>(null);
  const [name, setName] = useState('');
  const [skills, setSkills] = useState('');
  const [experience, setExperience] = useState('');
  const [hours, setHours] = useState(5);
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isOwner = me?.role === 'owner';

  function openEditor(member: ProjectMember) {
    setEditing(member);
    setName(member.display_name);
    setSkills(member.skills.join(', '));
    setExperience(member.experience);
    setHours(Number(member.hours_per_week) || 5);
    setEmail(member.email);
    setError(null);
  }

  async function saveMember() {
    if (!editing) return;
    if (!name.trim()) {
      setError('A name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: updateError } = await supabase()
        .from('project_members')
        .update({
          display_name: name.trim(),
          skills: splitList(skills),
          experience: experience.trim(),
          hours_per_week: hours,
        })
        .eq('id', editing.id);
      if (updateError) fail(updateError, 'Could not save the member');
      setEditing(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the member');
    } finally {
      setSaving(false);
    }
  }

  async function resendInvite(member: ProjectMember) {
    setBusyId(member.id);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase().rpc('claim_memberships');
      if (rpcError) fail(rpcError, 'Could not link pending invites');
      if (typeof data === 'number' && data === 0) {
        setError(
          `No pending invite matched your signed-in email. ${member.email} must sign up with that exact email to join.`,
        );
      } else {
        await onChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link pending invites');
    } finally {
      setBusyId(null);
    }
  }

  const totalHours = members.reduce((sum, member) => sum + Number(member.hours_per_week || 0), 0);

  return (
    <div className="stack">
      {error ? <div className="alert alert--error">{error}</div> : null}

      <Card>
        <CardHead
          title="Team"
          subtitle={`${members.length} member${members.length === 1 ? '' : 's'} · ${totalHours}h of availability per week in total`}
        />
        <div className="card__body stack">
          {members.map((member) => {
            const canEdit = isOwner || member.user_id === me?.user_id;
            return (
              <div key={member.id} className="member-row">
                <div className="member-row__main">
                  <div className="row row--between" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div className="row">
                      <span className="avatar">{member.display_name.slice(0, 2).toUpperCase()}</span>
                      <div className="stack stack--sm">
                        <strong>{member.display_name}</strong>
                        <span className="small muted">{member.email}</span>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {member.role === 'owner' ? <Badge tone="brand">owner</Badge> : <Badge tone="muted">member</Badge>}
                      <Badge tone={member.invite_status === 'accepted' ? 'ok' : 'warn'}>
                        {member.invite_status === 'accepted' ? 'joined' : 'invited'}
                      </Badge>
                      <Badge tone="muted">{member.hours_per_week}h/week</Badge>
                    </div>
                  </div>
                  <div className="small muted">
                    {member.skills.length > 0 ? member.skills.join(' · ') : 'No skills listed yet'}
                  </div>
                  {member.experience ? <div className="small muted">{member.experience}</div> : null}
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    {canEdit ? (
                      <Button size="sm" onClick={() => openEditor(member)}>
                        Edit details
                      </Button>
                    ) : null}
                    {member.invite_status !== 'accepted' && member.user_id === me?.user_id ? (
                      <Button size="sm" onClick={() => resendInvite(member)} loading={busyId === member.id}>
                        Claim this invite
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHead title="How invites work" />
        <div className="card__body small muted stack stack--sm">
          <p style={{ margin: 0 }}>
            TeamPilot cannot send email for you on the free plan. Share the signup link with teammates and tell them to
            register using <strong>the exact email you entered here</strong>.
          </p>
          <p style={{ margin: 0 }}>
            When they sign in, the database links their account to the invite automatically (via the{' '}
            <code>claim_memberships</code> function), and only then can they read this project, its tasks and its chat.
          </p>
          <p style={{ margin: 0 }}>
            Project owner for this workspace: <strong>{members.find((member) => member.role === 'owner')?.display_name ?? '—'}</strong>
            {' · '}subject: {project.subject}
          </p>
        </div>
      </Card>

      <Modal
        open={Boolean(editing)}
        title={`Edit ${editing?.display_name ?? 'member'}`}
        onClose={() => setEditing(null)}
        footer={
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveMember} loading={saving}>
              Save
            </Button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Name" full>
            <TextInput value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Email">
            <TextInput value={email} disabled onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Available hours / week">
            <TextInput
              type="number"
              min={1}
              max={60}
              step={1}
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
            />
          </Field>
          <Field label="Skills" hint="Comma separated, e.g. React, research, writing" full>
            <TextInput value={skills} onChange={(event) => setSkills(event.target.value)} />
          </Field>
          <Field label="Experience" full>
            <TextArea rows={3} value={experience} onChange={(event) => setExperience(event.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
