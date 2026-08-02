// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmPickModal } from './ConfirmPickModal';

const picks = [
  { gameId: 'game-1', team: 'Dallas Cowboys', spread: -3.5 },
  { gameId: 'game-2', team: 'Philadelphia Eagles', spread: 3.5 },
];

describe('ConfirmPickModal', () => {
  it('renders a summary of selected picks', () => {
    render(
      <ConfirmPickModal
        isOpen
        onCancel={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        picks={picks}
      />,
    );

    expect(
      screen.getByText(/this cannot be undone\. lock in these picks\?/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Dallas Cowboys')).toBeInTheDocument();
    expect(screen.getByText('-3.5')).toBeInTheDocument();
    expect(screen.getByText('Philadelphia Eagles')).toBeInTheDocument();
    expect(screen.getByText('+3.5')).toBeInTheDocument();
  });

  it('calls onCancel when cancel is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <ConfirmPickModal
        isOpen
        onCancel={onCancel}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        picks={picks}
      />,
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onSubmit when confirm is clicked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ConfirmPickModal
        isOpen
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        picks={picks}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^confirm$/i }));
    expect(onSubmit).toHaveBeenCalledWith(picks);
  });
});
