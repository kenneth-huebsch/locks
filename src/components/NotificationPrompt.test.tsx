// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationPrompt } from './NotificationPrompt';

const promptProps = {
  accessToken: 'token',
  isIos: false,
  isStandalone: true,
  loadVapidKey: vi.fn(),
  saveSubscription: vi.fn(),
};

describe('NotificationPrompt', () => {
  it('asks iPhone users to add Locks to the Home Screen', () => {
    render(
      <NotificationPrompt
        {...promptProps}
        isIos
        isStandalone={false}
      />,
    );

    expect(
      screen.getByText(/add locks to your home screen/i),
    ).toBeInTheDocument();
  });

  it('hides the enable button when permission is already granted', async () => {
    const onEnable = vi.fn().mockResolvedValue(undefined);

    render(
      <NotificationPrompt
        {...promptProps}
        notificationPermission="granted"
        onEnable={onEnable}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /enable pick alerts/i }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(onEnable).toHaveBeenCalledOnce();
    });
  });

  it('hides the prompt when permission was denied', () => {
    render(
      <NotificationPrompt
        {...promptProps}
        notificationPermission="denied"
        onEnable={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /enable pick alerts/i }),
    ).not.toBeInTheDocument();
  });

  it('enables notifications when the browser can subscribe', async () => {
    const user = userEvent.setup();
    const subscribe = vi.fn().mockResolvedValue(undefined);

    render(
      <NotificationPrompt
        {...promptProps}
        notificationPermission="default"
        onEnable={subscribe}
      />,
    );

    await user.click(screen.getByRole('button', { name: /enable pick alerts/i }));
    expect(subscribe).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /enable pick alerts/i }),
      ).not.toBeInTheDocument();
    });
  });
});
