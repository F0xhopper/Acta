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
    const p = parseQuery('tattoo studios in Digbeth');
    expect(p.category).toBeUndefined();
    expect(p.categoryKey).toBe('tattoo-studios');
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
