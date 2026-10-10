import { describe, expect, it } from 'vitest';
import { parseQuery, resolveCategory } from '../src/discover/parse-query.js';

describe('parseQuery', () => {
  it('splits category and area on "in"', () => {
    const p = parseQuery('plumbers in Erdington');
    expect(p.categoryRaw).toBe('plumbers');
    expect(p.area).toBe('Erdington');
    expect(p.categoryKey).toBe('plumber');
    expect(p.textQuery).toBe('plumbers in Erdington, Birmingham, UK');
  });
  it('handles "near" and multi-word areas', () => {
    const p = parseQuery('mobile hairdressers near Sutton Coldfield');
    expect(p.categoryRaw).toBe('mobile hairdressers');
    expect(p.area).toBe('Sutton Coldfield');
    expect(p.categoryKey).toBe('beauty');
  });
  it('defaults the area to Birmingham', () => {
    const p = parseQuery('barbers');
    expect(p.area).toBe('Birmingham');
    expect(p.textQuery).toBe('barbers in Birmingham, UK');
  });
  it('does not double up Birmingham', () => {
    expect(parseQuery('cafes in Moseley, Birmingham').textQuery).toBe('cafes in Moseley, Birmingham, UK');
    expect(parseQuery('cafes in Birmingham UK').textQuery).toBe('cafes in Birmingham, UK');
  });
  it('falls back to a slug for unknown categories', () => {
    const p = parseQuery('escape rooms in Digbeth');
    expect(p.category).toBeUndefined();
    expect(p.categoryKey).toBe('escape-rooms');
  });
  it('strips a trailing city from the category words and resolves new categories', () => {
    const p = parseQuery('Gym trainer coach birmingham');
    expect(p.categoryRaw).toBe('Gym trainer coach');
    expect(p.categoryKey).toBe('personal_trainer');
    expect(p.textQuery).toBe('Gym trainer coach in Birmingham, UK');
    expect(parseQuery('coach hire in Digbeth').categoryKey).toBe('coach_hire');
    expect(parseQuery('life coaches in Harborne').categoryKey).toBe('life_coach');
    expect(parseQuery('Coach in birmingham').category).toBeUndefined();
  });
  it('prefers the longest keyword match', () => {
    expect(resolveCategory('gas engineer')?.key).toBe('plumber');
    expect(resolveCategory('end of tenancy cleaning')?.key).toBe('cleaner');
  });
});

describe('parseQuery across markets', () => {
  it('finds the market from a neighbourhood and biases to it', () => {
    const p = parseQuery('barbers in Kings Heath');
    expect(p.market?.key).toBe('birmingham');
    expect(p.textQuery).toBe('barbers in Kings Heath, Birmingham, UK');
  });
  it('searches anywhere else as written, with no market', () => {
    const p = parseQuery('cafes in Didsbury, Manchester');
    expect(p.market).toBeUndefined();
    expect(p.area).toBe('Didsbury, Manchester');
    expect(p.textQuery).toBe('cafes in Didsbury, Manchester, UK');
    expect(parseQuery('plumbers in Leeds').textQuery).toBe('plumbers in Leeds, UK');
  });
  it('knows configured markets that are switched off', () => {
    const p = parseQuery('barbers in Earlsdon');
    expect(p.market?.key).toBe('coventry');
    expect(p.textQuery).toBe('barbers in Earlsdon, Coventry, UK');
  });
});

describe('category search words', () => {
  it('every category searches for words that resolve back to itself', async () => {
    const { loadCategories, categoryQuery } = await import('../src/config.js');
    for (const c of loadCategories()) expect(parseQuery(`${categoryQuery(c)} in Moseley`).categoryKey, c.key).toBe(c.key);
  });
});
