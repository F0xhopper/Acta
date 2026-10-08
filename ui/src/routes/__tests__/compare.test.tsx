import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FeedbackItem } from '../../../../src/ui/api-types';
import { commentsFor } from '../business/compare';
import { CompareView, sliderKey } from '../business/compare-view';

describe('sliderKey', () => {
  it('moves by five with arrows and jumps with Home and End', () => {
    expect(sliderKey(50, 'ArrowRight')).toBe(55);
    expect(sliderKey(50, 'ArrowLeft')).toBe(45);
    expect(sliderKey(2, 'ArrowDown')).toBe(0);
    expect(sliderKey(98, 'ArrowUp')).toBe(100);
    expect(sliderKey(40, 'Home')).toBe(0);
    expect(sliderKey(40, 'End')).toBe(100);
    expect(sliderKey(40, 'a')).toBeNull();
  });
});

const fb = (p: Partial<FeedbackItem>): FeedbackItem => ({ id: 1, slug: 's', page: '/', device: 'mobile', x: 0.5, y: 0.5, text: 't', cropUrl: null, round: 1, rule: false, resolved: null, createdAt: '', ...p });

describe('commentsFor', () => {
  it('picks the comments sent in the after round for this page and device, plus general notes', () => {
    const items = [fb({ id: 1 }), fb({ id: 2, round: 2 }), fb({ id: 3, page: '/gallery' }), fb({ id: 4, device: 'desktop' }), fb({ id: 5, page: null, device: null }), fb({ id: 6, device: null })];
    expect(commentsFor(items, 1, '/', 'mobile').map((f) => f.id)).toEqual([1, 5, 6]);
  });
});

const props = { before: '/a.png', after: '/b.png', beforeLabel: 'First build', afterLabel: 'Round 1', pins: [], selectedId: null, onSelectPin: () => undefined };

describe('CompareView', () => {
  it('has a keyboard slider that clips the before image', () => {
    render(<CompareView {...props} mode="slider" />);
    const slider = screen.getByRole('slider', { name: 'Before and after divider' });
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '60');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByAltText('First build').parentElement).toHaveStyle({ clipPath: 'inset(0 100% 0 0)' });
  });

  it('flips between before and after with Space', () => {
    render(<CompareView {...props} mode="flip" />);
    expect(screen.getByAltText('First build')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByAltText('Round 1')).toBeInTheDocument();
    expect(screen.queryByAltText('First build')).toBeNull();
  });

  it('shows both side by side', () => {
    render(<CompareView {...props} mode="side" />);
    expect(screen.getByAltText('First build')).toBeInTheDocument();
    expect(screen.getByAltText('Round 1')).toBeInTheDocument();
  });
});
