import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { SessionChecklist } from '../renderer/components/card/SessionChecklist';
import { useSessionStore } from '../renderer/store/sessionStore';

describe('SessionChecklist', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: {} });
  });

  it('renders nothing when the card has no session', () => {
    const { container } = render(<SessionChecklist cardId="crd_1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders each checklist item with a check or hourglass', () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'working',
      checklist: [
        { id: 'a', label: 'Read auth.py', done: true, seq: 0 },
        { id: 'b', label: 'Ran npm test', done: false, seq: 1 },
      ],
      messages: [],
      pendingApproval: null,
      lastError: null,
    });
    render(<SessionChecklist cardId="crd_1" />);
    expect(screen.getByText('Read auth.py')).toBeInTheDocument();
    expect(screen.getByText('Ran npm test')).toBeInTheDocument();
  });
});
