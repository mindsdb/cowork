// The own-work mode's message rules: what counts as the person's material,
// and the message sent, which is the wording the pre-release test measured.
import { describe, it, expect } from 'vitest';
import {
  OWN_WORK_MODE, OWN_WORK_JOB_GROUPS, OWN_WORK_LEAD, OWN_WORK_START_NOW, TASK_MODES,
  composeOwnWorkMessage, hasOwnMaterial, ownWorkJobIn, editedJobEnd,
} from './taskModes';
import enChat from '../../../../shared/i18n/locales/en/chat.json';

const JOB = 'Clean up this customer list and flag duplicates.';

describe('own-work jobs', () => {
  it('are the jobs of the four kinds of work, each a full sentence', () => {
    expect(OWN_WORK_JOB_GROUPS.map((g) => g.id)).toEqual(['finance', 'sales', 'operations', 'legal']);
    expect(OWN_WORK_MODE.samples).toHaveLength(12);
    for (const job of OWN_WORK_MODE.samples) expect(job.prompt).toMatch(/^[A-Z].*\.$/);
  });

  it('show in English exactly the sentence they send', () => {
    for (const group of OWN_WORK_JOB_GROUPS) {
      group.jobs.forEach((j, i) => expect(enChat.ownWork.jobs[group.id][String(i)]).toBe(j.prompt));
    }
  });

  it('never share a sentence with an example, so a job is never read as one', () => {
    const examples = TASK_MODES.flatMap((m) => m.samples.map((s) => s.prompt));
    for (const job of OWN_WORK_MODE.samples) {
      expect(examples.some((p) => p.startsWith(job.prompt) || job.prompt.startsWith(p))).toBe(false);
    }
  });

  it('ask for "the next monthly report", which the test read correctly, not "this month\'s"', () => {
    const labels = OWN_WORK_MODE.samples.map((j) => j.label).join(' ');
    expect(labels).toContain('next monthly report');
    expect(labels).not.toMatch(/this month/i);
  });
});

describe('hasOwnMaterial', () => {
  it('is false for nothing, and for a job on its own', () => {
    expect(hasOwnMaterial('')).toBe(false);
    expect(hasOwnMaterial('   ')).toBe(false);
    expect(hasOwnMaterial(`${JOB} `)).toBe(false);
  });

  it('is true for a file, pasted text or a link, with or without a job', () => {
    expect(hasOwnMaterial('', 1)).toBe(true);
    expect(hasOwnMaterial(`${JOB} `, 1)).toBe(true);
    expect(hasOwnMaterial('notes from the call')).toBe(true);
    expect(hasOwnMaterial(`${JOB} name,email`)).toBe(true);
    expect(hasOwnMaterial('https://example.com')).toBe(true);
  });

  describe('after a job was picked and then edited', () => {
    const picked = OWN_WORK_MODE.samples.find((j) => j.prompt === JOB);

    it('reads a shortened or reworded job as the job, with nothing to work on', () => {
      expect(hasOwnMaterial('Clean up this customer list and flag duplicates', 0, picked)).toBe(false);
      expect(hasOwnMaterial('Clean up this customer list.', 0, picked)).toBe(false);
      expect(hasOwnMaterial('Clean up this client list and flag duplicates.', 0, picked)).toBe(false);
    });

    it('counts a link or a few words of the person\'s own added to it', () => {
      expect(hasOwnMaterial('Clean up this customer list https://example.com/c.csv', 0, picked)).toBe(true);
      expect(hasOwnMaterial('Clean up this customer list: Ada, Bob, Cy', 0, picked)).toBe(true);
      expect(hasOwnMaterial('Clean up this customer list.', 1, picked)).toBe(true);
    });

    it('counts text that dropped the job as the person\'s own', () => {
      expect(hasOwnMaterial('Q3 numbers', 0, picked)).toBe(true);
    });
  });
});

describe('composeOwnWorkMessage', () => {
  it('sends a job, the start-now line, then the material', () => {
    expect(composeOwnWorkMessage(`${JOB} name,email\na,b`))
      .toBe(`${JOB} ${OWN_WORK_START_NOW}\n\nname,email\na,b`);
  });

  it('sends a job with a file as the job and the start-now line alone', () => {
    expect(composeOwnWorkMessage(`${JOB} `)).toBe(`${JOB} ${OWN_WORK_START_NOW}`);
  });

  it('uses the generic first step when there is no job', () => {
    expect(composeOwnWorkMessage('https://example.com/post'))
      .toBe(`${OWN_WORK_LEAD} ${OWN_WORK_START_NOW}\n\nhttps://example.com/post`);
    expect(composeOwnWorkMessage('')).toBe(`${OWN_WORK_LEAD} ${OWN_WORK_START_NOW}`);
  });

  it('tells Cowork not to open with a question', () => {
    expect(OWN_WORK_START_NOW).toMatch(/Don't ask me questions first\.$/);
    expect(OWN_WORK_START_NOW).toMatch(/tell me what you assumed/);
  });
});

describe('ownWorkJobIn', () => {
  it('finds the job a draft starts with, and only at the start', () => {
    expect(ownWorkJobIn(`${JOB} more`)?.prompt).toBe(JOB);
    expect(ownWorkJobIn(`please ${JOB}`)).toBeNull();
    expect(ownWorkJobIn('')).toBeNull();
  });
});

describe('editedJobEnd', () => {
  const picked = OWN_WORK_MODE.samples.find((j) => j.prompt === JOB);

  it('finds where an edited job ends, past its full stop', () => {
    const text = 'Clean up this client list and flag duplicates. name,email';
    expect(text.slice(editedJobEnd(text, picked)).trim()).toBe('name,email');
    const shortened = 'Clean up this customer list. Ada, Bob';
    expect(shortened.slice(editedJobEnd(shortened, picked)).trim()).toBe('Ada, Bob');
  });

  it('is -1 when the text does not open with the job, or no job was picked', () => {
    expect(editedJobEnd('Q3 numbers for the board', picked)).toBe(-1);
    expect(editedJobEnd(JOB, null)).toBe(-1);
  });
});
