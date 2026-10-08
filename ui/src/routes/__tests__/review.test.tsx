import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fractionFromPoint, PinCanvas } from '../business/pin-canvas';
import { fitScale } from '../business/review-live';

const rect = { left: 100, top: 50, width: 400, height: 2000 };

describe('fractionFromPoint', () => {
  it('maps a click to fractions of the image', () => {
    expect(fractionFromPoint(300, 1050, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(fractionFromPoint(100, 50, rect)).toEqual({ x: 0, y: 0 });
  });
  it('clamps points outside the image', () => {
    expect(fractionFromPoint(50, 5000, rect)).toEqual({ x: 0, y: 1 });
  });
  it('survives an unmeasured box', () => {
    expect(fractionFromPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('fitScale', () => {
  it('shrinks a wide frame and never enlarges', () => {
    expect(fitScale(720, 1440)).toBe(0.5);
    expect(fitScale(1000, 390)).toBe(1);
  });
});

function stubRect(el: HTMLElement) {
  el.getBoundingClientRect = () => ({ ...rect, right: 500, bottom: 2050, x: 100, y: 50, toJSON: () => ({}) });
}

describe('PinCanvas', () => {
  it('drops a draft pin where clicked and saves it with Enter', async () => {
    const onCreate = vi.fn();
    render(<PinCanvas src="/shot.png" alt="Home on phone" pins={[]} commentMode onCreate={onCreate} />);
    const canvas = screen.getByTestId('pin-canvas');
    stubRect(canvas);
    fireEvent.click(canvas, { clientX: 200, clientY: 550 });
    const box = screen.getByRole('textbox', { name: 'Comment' });
    await userEvent.type(box, 'Bigger heading');
    await userEvent.click(screen.getByLabelText('Also a pipeline rule'));
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledWith({ x: 0.25, y: 0.25, text: 'Bigger heading', rule: true });
  });

  it('does nothing on click outside comment mode, and Escape cancels a draft', () => {
    const onCreate = vi.fn();
    const { rerender } = render(<PinCanvas src="/s.png" alt="x" pins={[]} onCreate={onCreate} />);
    const canvas = screen.getByTestId('pin-canvas');
    stubRect(canvas);
    fireEvent.click(canvas, { clientX: 200, clientY: 550 });
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<PinCanvas src="/s.png" alt="x" pins={[]} commentMode onCreate={onCreate} />);
    fireEvent.click(canvas, { clientX: 200, clientY: 550 });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('renders pins as numbered buttons at their positions and moves them with arrow keys', () => {
    const onMove = vi.fn();
    const onSelect = vi.fn();
    render(<PinCanvas src="/s.png" alt="x" pins={[{ id: 7, n: 1, x: 0.5, y: 0.2, text: 'Logo too small', draggable: true }]} onMove={onMove} onSelect={onSelect} />);
    const pin = screen.getByRole('button', { name: 'Comment 1: Logo too small' });
    expect(pin).toHaveStyle({ left: '50%', top: '20%' });
    fireEvent.keyDown(pin, { key: 'ArrowRight' });
    expect(onMove).toHaveBeenCalledWith(7, 0.51, 0.2);
    fireEvent.keyDown(pin, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(7);
  });
});
