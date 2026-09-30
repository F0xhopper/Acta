// Managed by Acta. Do not edit. Label, control and error wired with ids and aria. No visual styling.
import type { ReactNode } from 'react';

interface FieldProps {
  id: string;
  name: string;
  label: ReactNode;
  type?: 'text' | 'email' | 'tel' | 'textarea';
  required?: boolean;
  autoComplete?: string;
  error?: string | null;
  className?: string;
  inputClassName?: string;
  rows?: number;
}

export function Field({ id, name, label, type = 'text', required, autoComplete, error, className, inputClassName, rows = 5 }: FieldProps) {
  const errId = `${id}-error`;
  const shared = { id, name, required, 'aria-required': required || undefined, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errId : undefined, className: inputClassName };
  return (
    <div className={className}>
      <label htmlFor={id}>{label}</label>
      {type === 'textarea' ? <textarea {...shared} rows={rows} /> : <input {...shared} type={type} autoComplete={autoComplete} />}
      {error ? <p id={errId} role="alert">{error}</p> : null}
    </div>
  );
}
