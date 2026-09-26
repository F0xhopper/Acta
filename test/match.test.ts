import { describe, expect, it } from 'vitest';
import { matchCompany } from '../src/discover/match.js';
import { nameSimilarity, normaliseName } from '../src/util/slug.js';

describe('names', () => {
  it('normalises company suffixes and punctuation', () => {
    expect(normaliseName('ACME PLUMBING & HEATING LIMITED')).toBe('acme plumbing and heating');
    expect(normaliseName('Acme Plumbing Ltd.')).toBe('acme plumbing');
  });
  it('similarity', () => {
    expect(nameSimilarity('Acme Plumbing Ltd', 'ACME PLUMBING LIMITED')).toBe(1);
    expect(nameSimilarity('Acme Plumbing', 'Acme Plumbing and Heating')).toBeCloseTo(0.67, 1);
    expect(nameSimilarity('Acme Plumbing', 'Zed Roofing')).toBe(0);
  });
});

describe('matchCompany', () => {
  const lead = { name: 'Acme Plumbing', outward_code: 'B23' };
  it('high when name and outward code agree', () => {
    const r = matchCompany(lead, [{ title: 'ACME PLUMBING LTD', company_number: '1', company_status: 'active', address: { postal_code: 'B23 6QQ' } }]);
    expect(r.confidence).toBe('high');
  });
  it('medium when postcode differs', () => {
    const r = matchCompany(lead, [{ title: 'ACME PLUMBING LTD', company_number: '1', company_status: 'active', address: { postal_code: 'SW1A 1AA' } }]);
    expect(r.confidence).toBe('medium');
  });
  it('ltd hint lifts a B-area medium to high', () => {
    const items = [{ title: 'ACME PLUMBING AND HEATING LTD', company_number: '1', company_status: 'active', address: { postal_code: 'B1 1AA' } }];
    expect(matchCompany({ name: 'Acme Plumbing & Heating', outward_code: 'B23' }, items, false).confidence).toBe('high'); // exact name, both in B
    const near = { name: 'Acme Plumbing and Heating Services', outward_code: 'B23' }; // similarity ~0.89
    expect(matchCompany(near, items, false).confidence).toBe('medium');
    expect(matchCompany(near, items, true).confidence).toBe('high');
  });
  it('ignores dissolved companies and picks the best', () => {
    const r = matchCompany(lead, [
      { title: 'ACME PLUMBING LTD', company_number: '1', company_status: 'dissolved', address: { postal_code: 'B23 6QQ' } },
      { title: 'ACME PLUMBING SERVICES LTD', company_number: '2', company_status: 'active', address: { postal_code: 'B23 6QQ' } },
    ]);
    expect(r.item?.company_number).toBe('2');
  });
  it('none when nothing is close', () => {
    expect(matchCompany(lead, [{ title: 'ZED ROOFING LTD', company_number: '9', company_status: 'active' }]).confidence).toBe('none');
  });
});
