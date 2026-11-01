import type { ReactNode } from 'react';

export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="help-tip">
      <summary aria-label={`Help for ${label}`}><span aria-hidden="true">?</span></summary>
      <div className="help-tip-content"><strong>{label}</strong><div>{children}</div></div>
    </details>
  );
}
