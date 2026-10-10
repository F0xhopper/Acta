import { describe, expect, it } from 'vitest';
import { expandAreas, inMarket, loadAreaGroups, marketFor, type Market } from '../src/discover/areas.js';
import { matchCompany } from '../src/discover/match.js';

const m = (key: string, active: boolean, groups: Record<string, string[]>, postcodes = ['B']): Market =>
  ({ key, name: key[0].toUpperCase() + key.slice(1), centre: [0, 0], radius_km: 10, postcodes, active, groups });
const markets = [m('birmingham', true, { trades: ['Erdington'], high_streets: ['Moseley'] }), m('coventry', false, { trades: ['Tile Hill'] }, ['CV']), m('leeds', true, { trades: ['Headingley'] }, ['LS'])];

describe('markets', () => {
  it('matches postcode areas exactly', () => {
    expect(inMarket('B23', markets[0])).toBe(true);
    expect(inMarket('BA1', markets[0])).toBe(false);
    expect(inMarket('CV8', markets[1])).toBe(true);
    expect(inMarket(null, markets[0])).toBe(false);
  });
  it('unions a group across active markets only', () => {
    const g = loadAreaGroups(markets);
    expect(g.trades).toEqual(['Erdington', 'Headingley']);
    expect(g.coventry).toEqual(['Tile Hill']);
    expect(expandAreas('plumbers', 'trades', g)).toEqual(['plumbers in Erdington', 'plumbers in Headingley']);
  });
  it('finds a market by name or neighbourhood', () => {
    expect(marketFor('moseley', markets)?.key).toBe('birmingham');
    expect(marketFor('Leeds', markets)?.key).toBe('leeds');
    expect(marketFor('Tile Hill', markets)?.key).toBe('coventry');
    expect(marketFor('Atlantis', markets)).toBeUndefined();
  });
});

describe('matchCompany outside Birmingham', () => {
  it('treats any shared postcode area like the B area', () => {
    const items = [{ title: 'ACME PLUMBING AND HEATING LTD', company_number: '1', company_status: 'active', address: { postal_code: 'LS1 1AA' } }];
    expect(matchCompany({ name: 'Acme Plumbing & Heating', outward_code: 'LS6' }, items).confidence).toBe('high');
    expect(matchCompany({ name: 'Acme Plumbing & Heating', outward_code: 'M20' }, items).confidence).toBe('medium');
  });
});
