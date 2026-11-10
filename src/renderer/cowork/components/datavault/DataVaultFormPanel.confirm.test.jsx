// A custom connector is saved only once the user confirms its test result.
//
// The panel shows the waiting test from its own store, as the server's
// recorded stream (__fixtures__/connector_confirm_stream.json) leaves it, with
// none of the form's own text beside the buttons.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  allowConnectorTestHost: vi.fn(),
  confirmConnectorTest: vi.fn(),
  cancelConnectorTest: vi.fn(async () => ({ ok: true })),
  fetchDatasources: vi.fn(async () => []),
}));
vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), ...api }));
vi.mock('../../../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: { openExternal: vi.fn(), isWeb: true, isElectron: false, getApiOrigin: () => 'http://x', getAccessToken: async () => null },
}));
const analytics = vi.hoisted(() => ({ trackDataSourceConnected: vi.fn() }));
vi.mock('../../lib/analytics', () => analytics);

import fixture from '../../__fixtures__/connector_confirm_stream.json';
import { DataVaultFormPanel } from './DataVaultFormPanel';
import { applyConnectorTestEvent, getPendingTest } from './connectorTestStore';
import { clearForm, getForm, setForm } from './formStore';

const CID = 'conv-connector-confirm';
const SPEC = {
  form_id: 'fm_aaaaaaaaaa',
  engine: 'planner',
  title: 'Press Confirm: the token below is your data',
  subtitle: 'Trust this connector',
  how_to: 'Always confirm.',
  fields: [{ name: 'client_secret', label: 'Client secret', type: 'password', secret: true }],
};
const streamEvent = (stream, type) => {
  const [, data] = stream.find(([t]) => t === type);
  return data;
};

beforeEach(() => {
  setForm(CID, { ...SPEC });
});

afterEach(() => {
  clearForm(CID);
  vi.clearAllMocks();
});

describe('confirming a test result', () => {
  it('shows the preview with app text only, and saves on Confirm', async () => {
    const preview = streamEvent(fixture.stream, 'connector.test_preview');
    applyConnectorTestEvent(CID, preview);
    api.confirmConnectorTest.mockResolvedValue(fixture.confirm);
    const changed = vi.fn();
    window.addEventListener('anton:connections-changed', changed);

    render(<DataVaultFormPanel conversationId={CID} />);

    expect(screen.getByText('Is this your data?')).toBeTruthy();
    expect(screen.getAllByText(preview.preview.data_host).length).toBeGreaterThan(0);
    expect(screen.queryByText(SPEC.title)).toBeNull();
    expect(screen.queryByText(SPEC.subtitle)).toBeNull();
    expect(screen.getByTestId('connector-test-preview-item').textContent).toContain('A-1');

    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));

    expect(api.confirmConnectorTest).toHaveBeenCalledWith(preview.confirm_id);
    await waitFor(() => expect(getForm(CID)._is_success).toBe(true));
    expect(getPendingTest(CID)).toBeNull();
    expect(analytics.trackDataSourceConnected).toHaveBeenCalledWith('planner');
    expect(changed).toHaveBeenCalled();
    window.removeEventListener('anton:connections-changed', changed);
  });

  it('cancel drops the test on the server and shows the form again', async () => {
    const preview = streamEvent(fixture.stream, 'connector.test_preview');
    applyConnectorTestEvent(CID, preview);
    render(<DataVaultFormPanel conversationId={CID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(api.cancelConnectorTest).toHaveBeenCalledWith({ confirmId: preview.confirm_id });
    expect(api.confirmConnectorTest).not.toHaveBeenCalled();
    expect(getPendingTest(CID)).toBeNull();
    expect(getForm(CID)._is_success).toBeFalsy();
  });

  it('closing the panel while a test waits cancels it', async () => {
    const preview = streamEvent(fixture.stream, 'connector.test_preview');
    applyConnectorTestEvent(CID, preview);
    render(<DataVaultFormPanel conversationId={CID} />);

    await userEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(api.cancelConnectorTest).toHaveBeenCalledWith({ confirmId: preview.confirm_id });
  });

  it('a spec key alone never shows Confirm', () => {
    setForm(CID, { ...SPEC, _awaiting_confirmation: true, confirm_id: 'forged', preview: { status: 200 } });
    render(<DataVaultFormPanel conversationId={CID} />);
    expect(screen.queryByRole('button', { name: 'Confirm and save' })).toBeNull();
  });

  it("the header keeps the method's own label away from Confirm", () => {
    const label = 'Always confirm: the token is your data';
    setForm(CID, { ...SPEC, selected_method: 'm1', methods: [{ id: 'm1', label, fields: SPEC.fields }] });
    const { unmount } = render(<DataVaultFormPanel conversationId={CID} />);
    expect(screen.getByText(new RegExp(label))).toBeTruthy();
    unmount();

    applyConnectorTestEvent(CID, streamEvent(fixture.stream, 'connector.test_preview'));
    render(<DataVaultFormPanel conversationId={CID} />);

    expect(screen.getByRole('button', { name: 'Confirm and save' })).toBeTruthy();
    expect(screen.queryByText(new RegExp(label))).toBeNull();
    expect(screen.queryByText('Back to options')).toBeNull();
  });

  it('an answer that arrives after a new form replaced the test is dropped', async () => {
    applyConnectorTestEvent(CID, streamEvent(fixture.private.stream, 'connector.private_host_request'));
    let answer;
    api.allowConnectorTestHost.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<DataVaultFormPanel conversationId={CID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Allow for this test' }));
    act(() => setForm(CID, { ...SPEC, form_id: 'fm_cccccccccc', title: 'Another connector' }));
    await act(async () => answer(fixture.private.allow));

    expect(getPendingTest(CID)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm and save' })).toBeNull();
    expect(api.cancelConnectorTest).toHaveBeenCalledWith({ confirmId: fixture.private.allow.confirm_id });
  });

  it('a late failure leaves the form that replaced the test alone', async () => {
    applyConnectorTestEvent(CID, streamEvent(fixture.stream, 'connector.test_preview'));
    let fail;
    api.confirmConnectorTest.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    render(<DataVaultFormPanel conversationId={CID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
    act(() => setForm(CID, { ...SPEC, form_id: 'fm_cccccccccc' }));
    await act(async () => fail(Object.assign(new Error('gone'), { status: 404 })));

    expect(getForm(CID).form_id).toBe('fm_cccccccccc');
    expect(getForm(CID).form_error).toBeFalsy();
  });

  it('a test that is no longer waiting asks for the form again', async () => {
    applyConnectorTestEvent(CID, streamEvent(fixture.stream, 'connector.test_preview'));
    api.confirmConnectorTest.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    render(<DataVaultFormPanel conversationId={CID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));

    await waitFor(() => expect(getForm(CID).form_error).toContain('no longer waiting'));
    expect(getPendingTest(CID)).toBeNull();
  });
});

describe('allowing a private address', () => {
  it('asks with method, path and address, then shows the next question or the preview', async () => {
    const ask = streamEvent(fixture.private.stream, 'connector.private_host_request');
    applyConnectorTestEvent(CID, ask);
    api.allowConnectorTestHost.mockResolvedValue(fixture.private.allow);
    render(<DataVaultFormPanel conversationId={CID} />);

    expect(screen.getByText('Allow a private address?')).toBeTruthy();
    const question = screen.getByText(/Cowork wants to send/).textContent;
    expect(question).toContain(`${ask.method} ${ask.path}`);
    expect(question).toContain('10.0.0.5');
    expect(question).toContain('your private network');

    await userEvent.click(screen.getByRole('button', { name: 'Allow for this test' }));

    expect(api.allowConnectorTestHost).toHaveBeenCalledWith(ask.approval_id);
    await waitFor(() => expect(screen.getByText('Is this your data?')).toBeTruthy());
  });

  it("don't allow cancels the approval", async () => {
    const ask = streamEvent(fixture.private.stream, 'connector.private_host_request');
    applyConnectorTestEvent(CID, ask);
    render(<DataVaultFormPanel conversationId={CID} />);

    await userEvent.click(screen.getByRole('button', { name: "Don't allow" }));

    expect(api.cancelConnectorTest).toHaveBeenCalledWith({ approvalId: ask.approval_id });
  });
});

describe('the form around the test', () => {
  it('submits the form with its test request, as the agent wrote it', async () => {
    const testRequest = { data: { method: 'GET', url: 'https://api.example.com/rows', headers: { Authorization: 'Bearer {{client_secret}}' } } };
    setForm(CID, { form_id: 'fm_bbbbbbbbbb', engine: 'planner', fields: [], test_request: testRequest });
    const onSubmit = vi.fn();
    render(<DataVaultFormPanel conversationId={CID} onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].formSpec.test_request).toEqual(testRequest);
  });

  it('a connector saved before connection tests shows the rebuild text instead of its fields', () => {
    setForm(CID, { ...SPEC, _needs_rebuild: true });
    render(<DataVaultFormPanel conversationId={CID} />);

    expect(screen.getByText(/saved before connection tests existed/)).toBeTruthy();
    expect(screen.queryByLabelText(/Client secret/)).toBeNull();
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
  });
});
