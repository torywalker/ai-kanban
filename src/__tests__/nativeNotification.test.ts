import { Notification } from 'electron';
import showTaskFinishedNotification from '../main/services/notifications';

jest.mock('electron', () => {
  const show = jest.fn();
  const NotificationMock = jest.fn(() => ({ show }));
  Object.assign(NotificationMock, {
    isSupported: jest.fn(() => true),
    show,
  });
  return { Notification: NotificationMock };
});

const notificationMock = Notification as unknown as jest.Mock & {
  isSupported: jest.Mock;
  show: jest.Mock;
};

describe('showTaskFinishedNotification', () => {
  beforeEach(() => {
    notificationMock.mockClear();
    notificationMock.isSupported.mockClear();
    notificationMock.show.mockClear();
  });

  it('shows a native completion notification for the card', () => {
    showTaskFinishedNotification('Fix the flaky tests');

    expect(notificationMock).toHaveBeenCalledWith({
      title: 'Claude task finished',
      body: 'Fix the flaky tests',
    });
    expect(notificationMock.show).toHaveBeenCalledTimes(1);
  });

  it('does nothing when native notifications are unsupported', () => {
    notificationMock.isSupported.mockReturnValueOnce(false);

    showTaskFinishedNotification('Fix the flaky tests');

    expect(notificationMock).not.toHaveBeenCalled();
    expect(notificationMock.show).not.toHaveBeenCalled();
  });
});
