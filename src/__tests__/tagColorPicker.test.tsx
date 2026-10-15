/**
 * Characterization test written to cover this component before its swatch
 * buttons were folded onto the shared ColorSwatch used by the card color
 * picker. It pins the behavior that must survive that refactor: the palette
 * is offered, a click reports the chosen hex, and the custom-color input
 * still works.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { TagColorPicker } from '@/components/tags/TagColorPicker';
import { TAG_PALETTE } from '@/domain/tags';

describe('TagColorPicker', () => {
  const open = (color: string, onChange = jest.fn()) => {
    render(<TagColorPicker color={color} onChange={onChange} label="urgent" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Change color for urgent' }),
    );
    return onChange;
  };

  it('offers every palette color', () => {
    open(TAG_PALETTE[0]);
    TAG_PALETTE.forEach((swatch) => {
      expect(
        screen.getByRole('button', { name: `Use ${swatch}` }),
      ).toBeInTheDocument();
    });
  });

  it('reports the palette color that was clicked', () => {
    const onChange = open(TAG_PALETTE[0]);
    fireEvent.click(
      screen.getByRole('button', { name: `Use ${TAG_PALETTE[3]}` }),
    );
    expect(onChange).toHaveBeenCalledWith(TAG_PALETTE[3]);
  });

  it('reports a custom color from the native picker', () => {
    const onChange = open(TAG_PALETTE[0]);
    fireEvent.change(screen.getByLabelText('Custom color'), {
      target: { value: '#123456' },
    });
    expect(onChange).toHaveBeenCalledWith('#123456');
  });
});
