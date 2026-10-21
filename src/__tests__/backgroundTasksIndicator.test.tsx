import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { BackgroundTaskBanner } from '@/components/card/BackgroundTasksIndicator';

describe('BackgroundTaskBanner', () => {
  it('shows each command the model put in the background', () => {
    render(
      <BackgroundTaskBanner
        tasks={[
          {
            id: 'b3b4je21r',
            description: 'Run full Jest test suite in background',
          },
        ]}
        continuing={false}
      />,
    );
    expect(screen.getByText('Background')).toBeInTheDocument();
    expect(
      screen.getByText('Run full Jest test suite in background'),
    ).toBeInTheDocument();
  });

  it('says when the command has finished and Claude has not continued', () => {
    render(<BackgroundTaskBanner tasks={[]} continuing />);
    expect(
      screen.getByText(
        'Background command finished. Waiting for Claude to continue.',
      ),
    ).toBeInTheDocument();
  });

  it('renders nothing when the turn has no background work', () => {
    const { container } = render(
      <BackgroundTaskBanner tasks={[]} continuing={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
