/**
 * Prompt construction.
 *
 * Written so the model only does what it is actually good at: reading a messy
 * problem statement and proposing a breakdown. It is explicitly told NOT to do
 * the arithmetic or pick owners - the deterministic planner does that, because
 * LLMs cannot be trusted to satisfy hard constraints reliably.
 */

import type { MemberInput } from '../src/shared/types.js';

const MAX_STATEMENT = 6000;

export const PLAN_SYSTEM_INSTRUCTION = `You are TeamPilot AI, an experienced university teaching assistant who turns student group-project briefs into realistic, buildable task breakdowns.

Rules you must follow exactly:
- Work only from the brief and the team description given. If the brief is vague, add reasonable generic university-project steps and record the gap in "assumptions".
- Do NOT assign tasks to people. Do NOT estimate who is available. A separate deterministic scheduler does that.
- Every task must be something a student can start on Monday morning: concrete verb, concrete artifact.
- Include the unglamorous work students forget: reading the brief, ethics/consent, data collection, accessibility, integration, testing, documentation, report writing, rehearsal.
- Use "id" values that are short unique slugs, referenced by other tasks in "depends_on".
- "depends_on" may only reference ids of OTHER top-level tasks. No cycles.
- required_skills must be chosen from this vocabulary where possible: research, writing, design, frontend, backend, database, testing, data-analysis, presentation, project-management, devops, mobile, documentation.
- estimated_hours is a realistic effort estimate for ONE student, between 0.5 and 24.
- complexity is 1 (trivial) to 5 (hard).
- Output JSON only. No markdown, no commentary.`;

export const PLAN_RESPONSE_SHAPE = `{
  "summary": "2-3 sentences describing the approach and the biggest risk",
  "assumptions": ["one line per assumption you had to make"],
  "tasks": [
    {
      "id": "research",
      "title": "Research and problem framing",
      "description": "What to produce and why it matters",
      "phase": "Discovery",
      "estimated_hours": 6,
      "complexity": 2,
      "required_skills": ["research", "writing"],
      "depends_on": [],
      "subtasks": [
        {
          "id": "literature",
          "title": "Find 5 credible sources",
          "description": "Peer-reviewed or official sources only",
          "estimated_hours": 3,
          "complexity": 2,
          "required_skills": ["research"]
        }
      ]
    }
  ]
}`;

export interface PlanPromptInput {
  project: {
    name: string;
    subject: string;
    problem_statement: string;
    deliverables: string[];
    start_date: string;
    deadline: string;
  };
  members: MemberInput[];
  today: string;
}

export function buildPlanPrompt(input: PlanPromptInput): string {
  const statement = (input.project.problem_statement || '').slice(0, MAX_STATEMENT);
  const deliverables =
    input.project.deliverables.length > 0
      ? input.project.deliverables.map((item) => `- ${item}`).join('\n')
      : '- (none listed - infer sensible academic deliverables)';

  const team =
    input.members.length > 0
      ? input.members
          .map(
            (member, index) =>
              `${index + 1}. ${member.display_name} - skills: ${
                member.skills.length ? member.skills.join(', ') : 'not listed'
              }; experience: ${member.experience}; available: ${member.hours_per_week} hours/week`,
          )
          .join('\n')
      : 'No team members were listed.';

  return `Design a task breakdown for this student group project.

PROJECT
Name: ${input.project.name}
Subject / course: ${input.project.subject || 'not specified'}
Start date: ${input.project.start_date}
Submission deadline: ${input.project.deadline}
Today: ${input.today}

PROBLEM STATEMENT
"""
${statement}
"""

REQUIRED DELIVERABLES
${deliverables}

TEAM (${input.members.length} people, for context only - do not assign work)
${team}

INSTRUCTIONS
- Produce 8 to 14 top-level tasks covering the whole project from kick-off to submission.
- Give each top-level task 1 to 4 subtasks. Subtask hours must add up to roughly the parent task's hours.
- Order tasks so that research and design come before build, and testing/reporting come last.
- Respect the real calendar: the work must be finishable between ${input.project.start_date} and ${input.project.deadline}.
- Keep the total effort realistic for a team of ${Math.max(input.members.length, 1)} part-time students.
- Include at least one testing/QA task and one documentation or report task.

Return JSON in exactly this shape (same keys, no extra keys):
${PLAN_RESPONSE_SHAPE}`;
}

export const CHAT_SYSTEM_INSTRUCTION = `You are TeamPilot AI, a concise project assistant for a student group project.

You receive a transcript of the team's group chat plus the current project state.
You do not invent facts: if the chat does not say it, do not claim it. If something is unclear, list it under "open_questions".

Rules:
- "summary" is 3-6 sentences: what the team discussed, what changed, and what that means for the plan.
- "decisions" are things the team actually agreed in the transcript.
- "open_questions" are unresolved points that need an answer.
- "action_items" are ONLY tasks that the chat implies are missing or needed. Do not repeat tasks that already exist in the project state.
- estimated_hours between 0.5 and 24, complexity 1-5.
- "owner_hint" is the name of the person the chat assigns it to, or null.
- Output JSON only.`;

export const CHAT_RESPONSE_SHAPE = `{
  "summary": "string",
  "decisions": ["string"],
  "open_questions": ["string"],
  "action_items": [
    {
      "title": "string",
      "description": "string",
      "owner_hint": "string or null",
      "estimated_hours": 3,
      "complexity": 2
    }
  ]
}`;

export interface ChatPromptInput {
  projectName: string;
  deadline: string;
  today: string;
  members: { display_name: string }[];
  existingTasks: { title: string; status: string; assignee: string | null }[];
  messages: { sender_name: string; body: string; created_at: string }[];
}

export function buildChatPrompt(input: ChatPromptInput): string {
  const transcript = input.messages
    .map((message) => {
      const time = new Date(message.created_at);
      const stamp = Number.isNaN(time.getTime())
        ? ''
        : `${String(time.getUTCHours()).padStart(2, '0')}:${String(time.getUTCMinutes()).padStart(2, '0')}`;
      return `[${stamp}] ${message.sender_name}: ${message.body}`;
    })
    .join('\n')
    .slice(0, 12_000);

  const tasks =
    input.existingTasks.length > 0
      ? input.existingTasks
          .map((task) => `- ${task.title} (${task.status}${task.assignee ? `, ${task.assignee}` : ', unassigned'})`)
          .join('\n')
      : '- (no tasks saved yet)';

  return `Summarise this group-project chat and suggest only the tasks that are genuinely missing.

PROJECT: ${input.projectName}
DEADLINE: ${input.deadline}
TODAY: ${input.today}
MEMBERS: ${input.members.map((member) => member.display_name).join(', ') || 'none listed'}

EXISTING TASKS (do not duplicate these)
${tasks}

CHAT TRANSCRIPT
"""
${transcript}
"""

Return JSON in exactly this shape (same keys, no extra keys):
${CHAT_RESPONSE_SHAPE}`;
}
