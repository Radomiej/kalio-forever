import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeNativeToolPicker } from './ClaudeNativeToolPicker';

describe('ClaudeNativeToolPicker', () => {
  it('keeps Claude built-ins opt-in and emits only the selected supported names', () => {
    const onChange = vi.fn();
    function Harness() {
      const [selected, setSelected] = useState(['Read']);
      return <ClaudeNativeToolPicker selected={selected} onChange={(next) => { onChange(next); setSelected(next); }} />;
    }
    render(<Harness />);

    expect(screen.getByTestId('claude-native-tool-Read')).toBeChecked();
    expect(screen.getByTestId('claude-native-tool-Bash')).not.toBeChecked();

    fireEvent.click(screen.getByTestId('claude-native-tool-WebSearch'));
    expect(onChange).toHaveBeenLastCalledWith(['Read', 'WebSearch']);

    fireEvent.click(screen.getByTestId('claude-native-tool-Read'));
    expect(onChange).toHaveBeenLastCalledWith(['WebSearch']);
  });
});
