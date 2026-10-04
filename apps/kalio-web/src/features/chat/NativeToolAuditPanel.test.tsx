import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '../../services/apiClient';
import { NativeToolAuditPanel } from './NativeToolAuditPanel';
vi.mock('../../services/apiClient', () => ({ apiClient: { get: vi.fn() } }));
const provider = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('./useTurnRuntimeProvider', () => ({ useTurnRuntimeProvider: () => provider.value }));
beforeEach(() => { vi.mocked(apiClient.get).mockReset(); provider.value = 'devin-cli-acp'; });
it('does not attribute native Devin tools to an unknown turn provider', () => {
  provider.value = undefined;
  render(<NativeToolAuditPanel sessionId="session" turnId="turn" />);
  expect(screen.queryByTestId('native-tool-audit-panel')).toBeNull();
  expect(apiClient.get).not.toHaveBeenCalled();
});
it('does not offer Devin audit for a recorded Codex turn or fetch any audit', () => {
  provider.value = 'codex-app-server';
  render(<NativeToolAuditPanel sessionId="session" turnId="turn" />);
  expect(screen.queryByTestId('native-tool-audit-panel')).toBeNull();
  expect(apiClient.get).not.toHaveBeenCalled();
});
it('explicitly limits this audit to Devin rather than claiming all providers are covered', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
  render(<NativeToolAuditPanel sessionId="session" turnId="turn" />);
  fireEvent.click(screen.getByRole('button', { name: 'Devin native tool audit' }));
  expect(await screen.findByText(/does not report native tools from other providers/)).toBeVisible();
});
it('loads only on demand with durable session/turn filters and displays policy block', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: [{ id: 'audit', sessionId: 'session', label: 'devin-cli-acp.native_approval', data: { turnId: 'turn', processEpoch: 'epoch', toolCallId: 'call', toolCallName: 'Read', decision: 'decline', decisionSource: 'policy' }, createdAt: 1 }] });
  render(<NativeToolAuditPanel sessionId="session" turnId="turn" />);
  expect(apiClient.get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Devin native tool audit' }));
  await waitFor(() => expect(screen.getByText(/Native Devin · blocked by policy/)).toBeVisible());
  expect(apiClient.get).toHaveBeenCalledOnce();
  expect(apiClient.get).toHaveBeenCalledWith('/api/audit-log?sessionId=session&turnId=turn&type=runtime_event&source=all&limit=2000');
});
it('does not describe a failed request as absence of native tools', async () => {
  vi.mocked(apiClient.get).mockRejectedValue(new Error('Audit unavailable'));
  render(<NativeToolAuditPanel sessionId="session" turnId="turn" />);
  fireEvent.click(screen.getByRole('button', { name: 'Devin native tool audit' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Audit unavailable');
  expect(screen.queryByText(/No correlated native evidence/)).toBeNull();
});
it('does not keep a prior tool status visible after a failed refresh', async () => {
  vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [{ id: 'audit', sessionId: 'session', label: 'devin-cli-acp.native_approval', data: { turnId: 'turn', processEpoch: 'epoch', toolCallId: 'call', toolCallName: 'Read', decision: 'decline', decisionSource: 'policy' }, createdAt: 1 }] });
  render(<NativeToolAuditPanel sessionId="session" turnId="turn" />);
  fireEvent.click(screen.getByRole('button', { name: 'Devin native tool audit' }));
  await screen.findByText(/Native Devin · blocked by policy/);
  vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('Refresh failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh native audit' }));
  expect(screen.queryByText(/Native Devin · blocked by policy/)).toBeNull();
  expect(await screen.findByRole('alert')).toHaveTextContent('Refresh failed');
  expect(screen.queryByText(/Native Devin · blocked by policy/)).toBeNull();
});
