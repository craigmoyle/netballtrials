import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HelpTip } from './HelpTip';

afterEach(cleanup);

describe('HelpTip', () => {
  it('keeps guidance collapsed until opened and exposes it to keyboard and assistive-technology users', () => {
    const { container } = render(<HelpTip label="Court rotation">The columns show how often each player appears on each court.</HelpTip>);
    expect(screen.queryByText(/columns show how often/i)).not.toBeVisible();
    const trigger = container.querySelector('summary')!;
    expect(trigger).toHaveAttribute('aria-label', 'Help for Court rotation');
    fireEvent.click(trigger);
    expect(trigger.parentElement).toHaveAttribute('open');
    expect(screen.getByText(/columns show how often/i)).toBeVisible();
  });
});
