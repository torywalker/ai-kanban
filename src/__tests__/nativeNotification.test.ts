import { Notification } from 'electron';
import showTaskFinishedNotification, {
  setNotificationsMuted,
  showBuildNotification,
} from '../main/services/notifications';

jest.mock('electron', () => {
  const show = jest.fn();
  const on = jest.fn();
  const NotificationMock = jest.fn(() => ({ show, on }));
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

  it('invokes the click callback when the notification is clicked', () => {
    const onClick = jest.fn();
    showTaskFinishedNotification('Fix the flaky tests', onClick);

    const instance = notificationMock.mock.results[0].value as {
      on: jest.Mock;
    };
    const clickHandler = instance.on.mock.calls.find(
      ([event]) => event === 'click',
    )?.[1] as () => void;
    clickHandler();

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows nothing while muted, including build notifications', () => {
    setNotificationsMuted(true);
    showTaskFinishedNotification('Fix the flaky tests');
    showBuildNotification('Build failed', 'main');
    setNotificationsMuted(false);

    expect(notificationMock).not.toHaveBeenCalled();
  });

  it('does nothing when native notifications are unsupported', () => {
    notificationMock.isSupported.mockReturnValueOnce(false);

    showTaskFinishedNotification('Fix the flaky tests');

    expect(notificationMock).not.toHaveBeenCalled();
    expect(notificationMock.show).not.toHaveBeenCalled();
  });
});
