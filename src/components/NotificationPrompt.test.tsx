// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationPrompt } from './NotificationPrompt';

describe('NotificationPrompt', () => {
  it('asks iPhone users to add Locks to the Home Screen', () => {
    render(
      <NotificationPrompt
        accessToken="token"
        isIos
        isStandalone={false}
        loadVapidKey={vi.fn()}
        saveSubscription={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/add locks to your home screen/i),
    ).toBeInTheDocument();
  });

  it('enables notifications when the browser can subscribe', async () => {
    const user = userEvent.setup();
    const subscribe = vi.fn().mockResolvedValue(undefined);

    render(
      <NotificationPrompt
        accessToken="token"
        isIos={false}
        isStandalone
        onEnable={subscribe}
        loadVapidKey={vi.fn()}
        saveSubscription={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /enable pick alerts/i }));
    expect(subscribe).toHaveBeenCalledOnce();
  });
});
