import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionProfile } from '@kalio/types';
import { getExecutionProfiles } from '../../../services/apiClient';
import { RAAppExecutionProfileControl } from './RAAppExecutionProfileControl';

vi.mock('../../../services/apiClient', () => ({ getExecutionProfiles: vi.fn() }));

describe('RA-App profile configuration', () => {
  beforeEach(() => vi.clearAllMocks());
  it('shows loading while existing profiles are being fetched', () => {
    vi.mocked(getExecutionProfiles).mockReturnValue(new Promise(() => undefined));
    render(<RAAppExecutionProfileControl value="" onChange={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
  it('selects an existing Devin profile without changing its runtime/model', async () => {
    const profile = { id: 'devin', name: 'Devin', kind: 'devin-cli-acp', model: 'swe-2', enabled: true } as ExecutionProfile;
    vi.mocked(getExecutionProfiles).mockResolvedValue([profile]);
    const onChange = vi.fn();
    render(<RAAppExecutionProfileControl value="" onChange={onChange} />);
    expect(await screen.findByRole('option', { name: 'Devin · devin-cli-acp · swe-2' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'devin' } });
    expect(onChange).toHaveBeenCalledWith('devin');
  });
  it('reports failure and does not silently replace an explicit profile', async () => {
    vi.mocked(getExecutionProfiles).mockRejectedValue(new Error('Offline'));
    const onChange = vi.fn();
    render(<RAAppExecutionProfileControl value="devin" onChange={onChange} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    expect(onChange).not.toHaveBeenCalled();
  });
  it('does not offer disabled execution profiles', async () => {
    vi.mocked(getExecutionProfiles).mockResolvedValue([
      { id: 'disabled', name: 'Disabled', enabled: false } as ExecutionProfile,
      { id: 'enabled', name: 'Enabled', enabled: true, kind: 'devin-cli-acp', model: 'swe-2' } as ExecutionProfile,
    ]);
    render(<RAAppExecutionProfileControl value="" onChange={vi.fn()} />);
    expect(await screen.findByRole('option', { name: /Enabled/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Disabled/ })).not.toBeInTheDocument();
  });
});
