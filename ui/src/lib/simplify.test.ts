import { describe, expect, it } from 'vitest';
import { stageOf } from './format';
import { bizPath } from './links';
import { outcomesFor } from '../routes/business/overview';

describe('one stage word per business', () => {
  it('says what needs you, not the build internals', () => {
    expect(stageOf('building', 'awaiting_photos').label).toBe('Needs photos');
    expect(stageOf('building', 'gated', true)).toEqual({ label: 'Building', tone: 'live' });
    expect(stageOf('preview_ready', 'preview_ready').label).toBe('To review');
    expect(stageOf('preview_ready', 'approved').label).toBe('Ready to send');
    expect(stageOf('building', 'failed').tone).toBe('bad');
    expect(stageOf('contacted', 'approved').label).toBe('Sent');
    expect(stageOf('shortlisted', 'picked').label).toBe('Picked');
  });
});

describe('business tab addresses', () => {
  it('maps the server tabs onto the four tabs', () => {
    expect(bizPath('oslo', 'photos')).toBe('/b/oslo/build?view=photos');
    expect(bizPath('oslo', 'progress')).toBe('/b/oslo/build');
    expect(bizPath('oslo', 'compare')).toBe('/b/oslo/review?mode=compare');
    expect(bizPath('oslo', 'deliver')).toBe('/b/oslo/send');
  });
});

describe('outcomes after the pitch', () => {
  it('offers the next sensible steps', () => {
    expect(outcomesFor('contacted')).toEqual(['replied', 'followup_1', 'won', 'lost']);
    expect(outcomesFor('followup_2')).not.toContain('followup_1');
    expect(outcomesFor('replied')).toEqual(['won', 'lost']);
    expect(outcomesFor('won')).toEqual([]);
  });
});
