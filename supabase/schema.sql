-- ===========================================================================
-- TeamPilot AI - complete Supabase schema
-- ---------------------------------------------------------------------------
-- HOW TO RUN (beginner friendly):
--   1. Open your Supabase project -> SQL Editor -> New query
--   2. Paste this whole file and press "Run"
--   3. Re-run it any time; everything is idempotent.
--
-- Security model:
--   * Every table has Row Level Security enabled.
--   * A project and its tasks/messages are visible only to people with an
--     accepted project_members row (or the project owner).
--   * Invited members are linked to their account by email the first time they
--     sign in (claim_memberships), so an invite cannot be taken by someone
--     else who guesses a project id.
--   * AI task/proposal insertion happens through SECURITY DEFINER functions,
--     never with a service-role key in the browser.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  subject text not null default '',
  problem_statement text not null default '',
  deliverables text[] not null default '{}',
  deadline date not null,
  start_date date not null default current_date,
  status text not null default 'planning' check (status in ('planning', 'active', 'completed')),
  plan_status text not null default 'none' check (plan_status in ('none', 'proposed', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  email text not null,
  display_name text not null,
  skills text[] not null default '{}',
  experience text not null default 'intermediate'
    check (experience in ('beginner', 'intermediate', 'advanced')),
  hours_per_week numeric not null default 8 check (hours_per_week > 0 and hours_per_week <= 80),
  role text not null default 'member' check (role in ('owner', 'member')),
  invite_status text not null default 'invited' check (invite_status in ('owner', 'invited', 'accepted')),
  created_at timestamptz not null default now()
);

create unique index if not exists project_members_project_email_key
  on public.project_members (project_id, lower(email));
create index if not exists project_members_user_idx on public.project_members (user_id);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  parent_task_id uuid references public.tasks (id) on delete cascade,
  assignee_member_id uuid references public.project_members (id) on delete set null,
  title text not null,
  description text not null default '',
  estimated_hours numeric not null default 2 check (estimated_hours > 0),
  complexity integer not null default 3 check (complexity between 1 and 5),
  required_skills text[] not null default '{}',
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'blocked', 'done')),
  due_date date,
  start_date date,
  sort_order integer not null default 0,
  phase text not null default 'Build',
  source text not null default 'manual' check (source in ('ai', 'manual', 'chat')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists tasks_assignee_idx on public.tasks (assignee_member_id);

create table if not exists public.task_dependencies (
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks (id) on delete cascade,
  primary key (task_id, depends_on_task_id),
  constraint task_dependencies_no_self check (task_id <> depends_on_task_id)
);

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  description text not null default '',
  due_date date not null,
  kind text not null default 'milestone' check (kind in ('milestone', 'testing', 'submission')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists milestones_project_idx on public.milestones (project_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  sender_user_id uuid not null references auth.users (id) on delete cascade,
  sender_member_id uuid references public.project_members (id) on delete set null,
  sender_name text not null default 'Teammate',
  body text not null check (length(trim(body)) > 0 and length(body) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists messages_project_created_idx
  on public.messages (project_id, created_at desc);

create table if not exists public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('plan', 'chat_tasks', 'chat_summary')),
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  title text not null default '',
  summary text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ai_suggestions_project_idx
  on public.ai_suggestions (project_id, created_at desc);

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  description text not null default '',
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  starts_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480)
);

create table if not exists public.poll_votes (
  poll_id uuid not null references public.polls (id) on delete cascade,
  option_id uuid not null references public.poll_options (id) on delete cascade,
  member_id uuid not null references public.project_members (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  response text not null check (response in ('yes', 'maybe', 'no')),
  updated_at timestamptz not null default now(),
  primary key (option_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so policies do not recurse)
-- ---------------------------------------------------------------------------

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.project_members m
     where m.project_id = p_project_id
       and m.user_id = auth.uid()
       and m.invite_status in ('accepted', 'owner')
  )
  or exists (
    select 1 from public.projects p
     where p.id = p_project_id
       and p.owner_id = auth.uid()
  );
$$;

create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects p
     where p.id = p_project_id
       and p.owner_id = auth.uid()
  );
$$;

grant execute on function public.is_project_member(uuid) to authenticated;
grant execute on function public.is_project_owner(uuid) to authenticated;

-- Auto-create a profile for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Every project gets an owner membership row automatically.
create or replace function public.handle_new_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_name text;
begin
  select lower(coalesce(u.email, '')),
         coalesce(u.raw_user_meta_data ->> 'full_name', split_part(coalesce(u.email, ''), '@', 1))
    into v_email, v_name
    from auth.users u
   where u.id = new.owner_id;

  insert into public.project_members
    (project_id, user_id, email, display_name, skills, experience, hours_per_week, role, invite_status)
  values
    (new.id, new.owner_id, coalesce(v_email, ''), coalesce(v_name, 'Project owner'),
     '{}', 'intermediate', 10, 'owner', 'owner')
  on conflict (project_id, lower(email)) do update
    set user_id = excluded.user_id,
        role = 'owner',
        invite_status = 'owner';

  return new;
end;
$$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();

-- Keep updated_at fresh.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- Chat display name is copied from the membership row, never from the client.
create or replace function public.set_message_sender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select m.display_name into v_name
    from public.project_members m
   where m.id = new.sender_member_id
     and m.project_id = new.project_id
     and m.user_id = new.sender_user_id;

  if v_name is null then
    raise exception 'You are not an accepted member of this project';
  end if;

  new.sender_name := v_name;
  new.sender_user_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists messages_set_sender on public.messages;
create trigger messages_set_sender before insert on public.messages
  for each row execute function public.set_message_sender();

-- Link invited rows to the signed-in account whose verified email matches.
create or replace function public.claim_memberships()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select lower(coalesce(email, '')) into v_email from auth.users where id = v_uid;
  if v_email is null or v_email = '' then
    return 0;
  end if;

  insert into public.profiles (id, email)
  values (v_uid, v_email)
  on conflict (id) do nothing;

  update public.project_members m
     set user_id = v_uid,
         invite_status = 'accepted'
   where m.user_id is null
     and lower(m.email) = v_email;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.claim_memberships() to authenticated;

-- ---------------------------------------------------------------------------
-- Plan approval: the only path that writes AI tasks. One transaction.
-- ---------------------------------------------------------------------------
create or replace function public.apply_plan(p_suggestion_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_suggestion public.ai_suggestions;
  v_payload jsonb;
  v_task jsonb;
  v_new_id uuid;
  v_map jsonb := '{}'::jsonb;
  v_dep record;
  v_member uuid;
  v_index integer;
  v_milestone jsonb;
  v_kind text;
begin
  select * into v_suggestion from public.ai_suggestions where id = p_suggestion_id;
  if not found then
    raise exception 'Plan proposal not found';
  end if;
  if not public.is_project_member(v_suggestion.project_id) then
    raise exception 'You are not a member of this project';
  end if;
  if v_suggestion.kind <> 'plan' then
    raise exception 'This suggestion is not a project plan';
  end if;
  if v_suggestion.status = 'applied' then
    return v_suggestion.project_id;
  end if;

  v_payload := v_suggestion.payload;

  -- Replace the previous AI plan (manual and chat tasks are kept).
  delete from public.tasks
   where project_id = v_suggestion.project_id
     and source = 'ai';

  -- Pass 1: parent / standalone tasks.
  for v_task in
    select value from jsonb_array_elements(coalesce(v_payload -> 'tasks', '[]'::jsonb))
  loop
    if coalesce(v_task ->> 'parent_key', '') <> '' then
      continue;
    end if;

    select m.id into v_member
      from public.project_members m
     where m.id = nullif(v_task ->> 'assignee_member_id', '')::uuid
       and m.project_id = v_suggestion.project_id;

    insert into public.tasks (
      project_id, assignee_member_id, title, description, estimated_hours,
      complexity, required_skills, due_date, start_date, phase, source, sort_order, created_by
    ) values (
      v_suggestion.project_id,
      v_member,
      coalesce(v_task ->> 'title', 'Untitled task'),
      coalesce(v_task ->> 'description', ''),
      greatest(coalesce((v_task ->> 'estimated_hours')::numeric, 2), 0.5),
      least(greatest(coalesce((v_task ->> 'complexity')::integer, 3), 1), 5),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(coalesce(v_task -> 'required_skills', '[]'::jsonb)) as value),
        '{}'
      ),
      nullif(v_task ->> 'due_date', '')::date,
      nullif(v_task ->> 'start_date', '')::date,
      coalesce(nullif(v_task ->> 'phase', ''), 'Build'),
      'ai',
      coalesce((v_task ->> 'sort_order')::integer, 0),
      auth.uid()
    )
    returning id into v_new_id;

    v_map := v_map || jsonb_build_object(v_task ->> 'key', v_new_id::text);
  end loop;

  -- Pass 2: subtasks (parent already exists).
  for v_task in
    select value from jsonb_array_elements(coalesce(v_payload -> 'tasks', '[]'::jsonb))
  loop
    if coalesce(v_task ->> 'parent_key', '') = '' then
      continue;
    end if;

    select m.id into v_member
      from public.project_members m
     where m.id = nullif(v_task ->> 'assignee_member_id', '')::uuid
       and m.project_id = v_suggestion.project_id;

    insert into public.tasks (
      project_id, parent_task_id, assignee_member_id, title, description, estimated_hours,
      complexity, required_skills, due_date, start_date, phase, source, sort_order, created_by
    ) values (
      v_suggestion.project_id,
      (v_map ->> (v_task ->> 'parent_key'))::uuid,
      v_member,
      coalesce(v_task ->> 'title', 'Untitled subtask'),
      coalesce(v_task ->> 'description', ''),
      greatest(coalesce((v_task ->> 'estimated_hours')::numeric, 2), 0.5),
      least(greatest(coalesce((v_task ->> 'complexity')::integer, 3), 1), 5),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(coalesce(v_task -> 'required_skills', '[]'::jsonb)) as value),
        '{}'
      ),
      nullif(v_task ->> 'due_date', '')::date,
      nullif(v_task ->> 'start_date', '')::date,
      coalesce(nullif(v_task ->> 'phase', ''), 'Build'),
      'ai',
      coalesce((v_task ->> 'sort_order')::integer, 0),
      auth.uid()
    )
    returning id into v_new_id;

    v_map := v_map || jsonb_build_object(v_task ->> 'key', v_new_id::text);
  end loop;

  -- Dependencies, only between tasks that were just created.
  for v_dep in
    select t.value ->> 'key' as task_key, dep.value as dep_key
      from jsonb_array_elements(coalesce(v_payload -> 'tasks', '[]'::jsonb)) t
      cross join lateral jsonb_array_elements_text(coalesce(t.value -> 'depends_on', '[]'::jsonb)) dep
  loop
    if v_map ? v_dep.task_key and v_map ? v_dep.dep_key and v_dep.task_key <> v_dep.dep_key then
      insert into public.task_dependencies (task_id, depends_on_task_id)
      values ((v_map ->> v_dep.task_key)::uuid, (v_map ->> v_dep.dep_key)::uuid)
      on conflict do nothing;
    end if;
  end loop;

  -- Timeline checkpoints.
  v_index := 0;
  for v_milestone in
    select value from jsonb_array_elements(coalesce(v_payload -> 'timeline', '[]'::jsonb))
  loop
    v_index := v_index + 1;
    v_kind := coalesce(nullif(v_milestone ->> 'kind', ''), 'milestone');
    if v_kind not in ('milestone', 'testing', 'submission') then
      v_kind := 'milestone';
    end if;

    insert into public.milestones (project_id, title, description, due_date, kind, sort_order)
    values (
      v_suggestion.project_id,
      coalesce(nullif(v_milestone ->> 'title', ''), 'Checkpoint'),
      coalesce(v_milestone ->> 'description', ''),
      coalesce(nullif(v_milestone ->> 'due_date', '')::date, current_date),
      v_kind,
      v_index
    );
  end loop;

  update public.ai_suggestions
     set status = 'applied'
   where id = p_suggestion_id;

  update public.ai_suggestions
     set status = 'dismissed'
   where project_id = v_suggestion.project_id
     and kind = 'plan'
     and id <> p_suggestion_id
     and status = 'pending';

  update public.projects
     set plan_status = 'approved',
         status = 'active'
   where id = v_suggestion.project_id;

  return v_suggestion.project_id;
end;
$$;

grant execute on function public.apply_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.milestones enable row level security;
alter table public.messages enable row level security;
alter table public.ai_suggestions enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

-- profiles ------------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- projects ------------------------------------------------------------------
drop policy if exists "projects_select_member" on public.projects;
create policy "projects_select_member" on public.projects
  for select to authenticated
  using (owner_id = auth.uid() or public.is_project_member(id));

drop policy if exists "projects_insert_owner" on public.projects;
create policy "projects_insert_owner" on public.projects
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "projects_update_member" on public.projects;
create policy "projects_update_member" on public.projects
  for update to authenticated
  using (public.is_project_member(id))
  with check (public.is_project_member(id));

drop policy if exists "projects_delete_owner" on public.projects;
create policy "projects_delete_owner" on public.projects
  for delete to authenticated using (owner_id = auth.uid());

-- project_members -----------------------------------------------------------
drop policy if exists "members_select_member" on public.project_members;
create policy "members_select_member" on public.project_members
  for select to authenticated using (public.is_project_member(project_id));

drop policy if exists "members_insert_owner" on public.project_members;
create policy "members_insert_owner" on public.project_members
  for insert to authenticated with check (public.is_project_owner(project_id));

drop policy if exists "members_update_owner" on public.project_members;
create policy "members_update_owner" on public.project_members
  for update to authenticated
  using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

drop policy if exists "members_delete_owner" on public.project_members;
create policy "members_delete_owner" on public.project_members
  for delete to authenticated using (public.is_project_owner(project_id));

-- tasks ---------------------------------------------------------------------
drop policy if exists "tasks_select_member" on public.tasks;
create policy "tasks_select_member" on public.tasks
  for select to authenticated using (public.is_project_member(project_id));

drop policy if exists "tasks_insert_member" on public.tasks;
create policy "tasks_insert_member" on public.tasks
  for insert to authenticated with check (public.is_project_member(project_id));

drop policy if exists "tasks_update_member" on public.tasks;
create policy "tasks_update_member" on public.tasks
  for update to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

drop policy if exists "tasks_delete_member" on public.tasks;
create policy "tasks_delete_member" on public.tasks
  for delete to authenticated using (public.is_project_member(project_id));

-- task_dependencies ---------------------------------------------------------
drop policy if exists "deps_select_member" on public.task_dependencies;
create policy "deps_select_member" on public.task_dependencies
  for select to authenticated using (
    exists (select 1 from public.tasks t where t.id = task_id and public.is_project_member(t.project_id))
  );

drop policy if exists "deps_write_member" on public.task_dependencies;
create policy "deps_write_member" on public.task_dependencies
  for insert to authenticated with check (
    exists (select 1 from public.tasks t where t.id = task_id and public.is_project_member(t.project_id))
  );

drop policy if exists "deps_delete_member" on public.task_dependencies;
create policy "deps_delete_member" on public.task_dependencies
  for delete to authenticated using (
    exists (select 1 from public.tasks t where t.id = task_id and public.is_project_member(t.project_id))
  );

-- milestones ----------------------------------------------------------------
drop policy if exists "milestones_select_member" on public.milestones;
create policy "milestones_select_member" on public.milestones
  for select to authenticated using (public.is_project_member(project_id));

drop policy if exists "milestones_write_member" on public.milestones;
create policy "milestones_write_member" on public.milestones
  for insert to authenticated with check (public.is_project_member(project_id));

drop policy if exists "milestones_update_member" on public.milestones;
create policy "milestones_update_member" on public.milestones
  for update to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

drop policy if exists "milestones_delete_member" on public.milestones;
create policy "milestones_delete_member" on public.milestones
  for delete to authenticated using (public.is_project_member(project_id));

-- messages ------------------------------------------------------------------
drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member" on public.messages
  for select to authenticated using (public.is_project_member(project_id));

drop policy if exists "messages_insert_member" on public.messages;
create policy "messages_insert_member" on public.messages
  for insert to authenticated with check (
    sender_user_id = auth.uid()
    and public.is_project_member(project_id)
    and exists (
      select 1 from public.project_members m
       where m.id = sender_member_id
         and m.project_id = messages.project_id
         and m.user_id = auth.uid()
    )
  );

drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own" on public.messages
  for delete to authenticated using (sender_user_id = auth.uid());

-- ai_suggestions ------------------------------------------------------------
drop policy if exists "suggestions_select_member" on public.ai_suggestions;
create policy "suggestions_select_member" on public.ai_suggestions
  for select to authenticated using (public.is_project_member(project_id));

drop policy if exists "suggestions_insert_member" on public.ai_suggestions;
create policy "suggestions_insert_member" on public.ai_suggestions
  for insert to authenticated with check (
    public.is_project_member(project_id) and created_by = auth.uid()
  );

drop policy if exists "suggestions_update_member" on public.ai_suggestions;
create policy "suggestions_update_member" on public.ai_suggestions
  for update to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

-- polls ---------------------------------------------------------------------
drop policy if exists "polls_select_member" on public.polls;
create policy "polls_select_member" on public.polls
  for select to authenticated using (public.is_project_member(project_id));

drop policy if exists "polls_insert_member" on public.polls;
create policy "polls_insert_member" on public.polls
  for insert to authenticated with check (
    public.is_project_member(project_id) and created_by = auth.uid()
  );

drop policy if exists "polls_delete_creator" on public.polls;
create policy "polls_delete_creator" on public.polls
  for delete to authenticated using (created_by = auth.uid() or public.is_project_owner(project_id));

drop policy if exists "poll_options_select_member" on public.poll_options;
create policy "poll_options_select_member" on public.poll_options
  for select to authenticated using (
    exists (select 1 from public.polls p where p.id = poll_id and public.is_project_member(p.project_id))
  );

drop policy if exists "poll_options_insert_member" on public.poll_options;
create policy "poll_options_insert_member" on public.poll_options
  for insert to authenticated with check (
    exists (select 1 from public.polls p where p.id = poll_id and public.is_project_member(p.project_id))
  );

drop policy if exists "poll_votes_select_member" on public.poll_votes;
create policy "poll_votes_select_member" on public.poll_votes
  for select to authenticated using (
    exists (select 1 from public.polls p where p.id = poll_id and public.is_project_member(p.project_id))
  );

drop policy if exists "poll_votes_write_self" on public.poll_votes;
create policy "poll_votes_write_self" on public.poll_votes
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.polls p
       where p.id = poll_id and public.is_project_member(p.project_id)
    )
    and exists (
      select 1 from public.project_members m
       where m.id = member_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "poll_votes_update_self" on public.poll_votes;
create policy "poll_votes_update_self" on public.poll_votes
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "poll_votes_delete_self" on public.poll_votes;
create policy "poll_votes_delete_self" on public.poll_votes
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime for chat, task status and poll tallies
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'poll_votes'
  ) then
    alter publication supabase_realtime add table public.poll_votes;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'milestones'
  ) then
    alter publication supabase_realtime add table public.milestones;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Grants (RLS still applies on top of these)
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
