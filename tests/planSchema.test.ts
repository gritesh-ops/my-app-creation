import { describe, expect, it } from 'vitest';
import { AiPlanError, parseChatSummary, parsePlanPayload } from '../src/shared/planSchema.js';

const validPlan = {
  summary: 'Split the app into design, build and testing work.',
  assumptions: ['Everyone can meet weekly on Thursday.'],
  tasks: [
    {
      key: 't1',
      title: 'Database schema',
      description: 'Model users, projects and tasks.',
      estimated_hours: 6,
      complexity: 3,
      required_skills: ['database'],
      depends_on: [],
      phase: 'Design',
    },
    {
      key: 't2',
      title: 'API',
      description: 'Expose REST endpoints.',
      estimated_hours: 8,
      complexity: 4,
      required_skills: ['api'],
      depends_on: ['t1'],
      phase: 'Build',
    },
  ],
};

describe('parsePlanPayload', () => {
  it('accepts a well formed AI plan', () => {
    const parsed = parsePlanPayload(validPlan);
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.tasks[1].depends_on).toEqual(['t1']);
    expect(parsed.summary).toContain('design');
  });

  it('rejects payloads without tasks', () => {
    expect(() => parsePlanPayload({ summary: 'x', tasks: [] })).toThrow(AiPlanError);
    expect(() => parsePlanPayload({ summary: 'x' })).toThrow(/task/i);
  });

  it('rejects non object payloads and non numeric hours', () => {
    expect(() => parsePlanPayload('nope')).toThrow(AiPlanError);
    const bad = structuredClone(validPlan);
    (bad.tasks[0] as unknown as { estimated_hours: unknown }).estimated_hours = 'lots';
    expect(() => parsePlanPayload(bad)).toThrow(AiPlanError);
  });

  it('normalises missing optional fields instead of failing', () => {
    const minimal = {
      tasks: [{ key: 'a', title: 'Only task', estimated_hours: 3, complexity: 2 }],
    };
    const parsed = parsePlanPayload(minimal);
    expect(parsed.tasks[0].required_skills).toEqual([]);
    expect(parsed.tasks[0].depends_on).toEqual([]);
    expect(parsed.assumptions).toEqual([]);
  });
});

describe('parseChatSummary', () => {
  it('extracts summary, decisions, questions and action items', () => {
    const parsed = parseChatSummary({
      summary: 'The team agreed to build the login flow first.',
      decisions: ['Use email login only'],
      open_questions: ['Who owns testing?'],
      action_items: [
        {
          title: 'Build login screen',
          description: 'Email + password form',
          owner_hint: 'Ada',
          estimated_hours: 4,
          complexity: 2,
        },
      ],
    });
    expect(parsed.decisions).toContain('Use email login only');
    expect(parsed.open_questions[0]).toMatch(/testing/i);
    expect(parsed.action_items[0].owner_hint).toBe('Ada');
    expect(parsed.action_items[0].estimated_hours).toBe(4);
  });

  it('throws when the model returns nothing usable', () => {
    expect(() => parseChatSummary({ summary: '' })).toThrow(AiPlanError);
  });
});
