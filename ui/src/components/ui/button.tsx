import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '../../lib/cn';
import { Spinner } from './spinner';

/**
 * The one button. Every size is a pill. `primary` is monochrome: ink on paper, paper on ink.
 * `loading` swaps the label for a spinner in place, so the button keeps its width.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const BASE = 'relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 text-sm font-medium whitespace-nowrap transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-(--ease-out) active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45';
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg shadow-[0_8px_24px_-10px_rgba(255,255,255,0.45)] hover:ring-4 hover:ring-white/15',
  secondary: 'border border-border-soft bg-white/[0.07] text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md hover:bg-white/[0.12]',
  outline: 'border border-border-soft text-fg-2 hover:bg-white/[0.06] hover:text-fg',
  ghost: 'text-fg-2 hover:bg-raised hover:text-fg',
  link: 'text-fg underline-offset-2 hover:underline',
};
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 rounded-full px-2.5 text-xs',
  md: 'h-(--row-h) rounded-full px-3.5',
  lg: 'h-(--btn-lg) rounded-full px-5',
  icon: 'size-(--row-h) rounded-full',
  'icon-sm': 'size-7 rounded-full',
};
export const buttonClass = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string) => cn(BASE, VARIANTS[variant], SIZES[size], className);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean; children?: ReactNode }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant, size, loading, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)} {...rest}>
      <span className={cn('inline-flex items-center gap-1.5', loading && 'opacity-0')}>{children}</span>
      {loading ? <span className="absolute inset-0 grid place-items-center"><Spinner /></span> : null}
    </button>
  );
});

/** A link that looks like a button. A real anchor, so it reads as a link to a screen reader. */
export function ButtonLink({ variant, size, className, ...rest }: LinkProps & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

/** An external link styled as a button; opens in a new tab. */
export function ButtonA({ variant, size, className, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <a target="_blank" rel="noreferrer" className={buttonClass(variant, size, className)} {...rest} />;
}
