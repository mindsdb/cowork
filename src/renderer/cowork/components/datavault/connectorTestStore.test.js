// A waiting connection test is read from the server's own stream events, as
// recorded from cowork-server (tests/test_connector_confirm.py writes the
// fixture), and kept out of the form spec and the stream state.

import { afterEach, describe, expect, it, vi } from 'vitest';

import fixture from '../../__fixtures__/connector_confirm_stream.json';
import { streamDataVaultSubmission } from '../../api';
import {
  applyConnectorTestEvent, clearPendingTest, getPendingTest, movePendingTest,
  pendingTestFromAnswer, pendingTestFromEvent, setPendingTest, setPendingTestCanceller,
} from './connectorTestStore';
import { setForm, clearForm, getForm, getSelectedMethod, moveForm, patchForm, setSelectedMethod } from './formStore';

const CID = 'conv-connector-test';
const events = (stream) => stream.map(([type, data]) => ({ type, ...data, type: data.type || type }));
const previewEvent = events(fixture.stream).find((e) => e.type === 'connector.test_preview');
const askEvent = events(fixture.private.stream).find((e) => e.type === 'connector.private_host_request');

afterEach(() => {
  clearPendingTest(CID);
  clearForm(CID);
  vi.unstubAllGlobals();
});

describe('reading the server events', () => {
  it('reads a test result to confirm', () => {
    expect(pendingTestFromEvent(previewEvent)).toEqual({
      kind: 'confirm', formId: previewEvent.form_id, id: previewEvent.confirm_id, preview: previewEvent.preview,
    });
  });

  it('reads a private host to allow, with what the question shows', () => {
    const pending = pendingTestFromEvent(askEvent);
    expect(pending.kind).toBe('approval');
    expect(pending.id).toBe(askEvent.approval_id);
    expect(pending.host).toMatchObject({ method: 'POST', host: 'planner.example.com', addresses: ['10.0.0.5'] });
    expect(pending.host.approval_id).toBeUndefined();
  });

  it('ignores every other event', () => {
    for (const ev of events(fixture.stream).filter((e) => !e.type.startsWith('connector.'))) {
      expect(pendingTestFromEvent(ev)).toBeNull();
      expect(applyConnectorTestEvent(CID, ev)).toBe(false);
    }
    expect(getPendingTest(CID)).toBeNull();
  });

  it('reads the preview an allow answer leads to', () => {
    const next = pendingTestFromAnswer('fm_aaaaaaaaaa', fixture.private.allow);
    expect(next).toMatchObject({ kind: 'confirm', id: fixture.private.allow.confirm_id });
    expect(pendingTestFromAnswer('fm_aaaaaaaaaa', { patch: { form_error: 'x' } })).toBeNull();
  });
});

describe('keeping it apart from the form', () => {
  it('is never written into the spec, and a patch does not clear it', () => {
    setForm(CID, { form_id: 'fm_aaaaaaaaaa', title: 'Connect Planner' });
    applyConnectorTestEvent(CID, previewEvent);
    patchForm(CID, { form_id: 'fm_aaaaaaaaaa', _awaiting_confirmation: true });

    expect(getPendingTest(CID)?.id).toBe(previewEvent.confirm_id);
  });

  it('is cleared by any new form, so an agent-emitted form never inherits Confirm', () => {
    setForm(CID, { form_id: 'fm_aaaaaaaaaa', title: 'Connect Planner' });
    applyConnectorTestEvent(CID, previewEvent);
    setForm(CID, { form_id: 'fm_aaaaaaaaaa', title: 'Connect Planner again' });
    expect(getPendingTest(CID)).toBeNull();

    applyConnectorTestEvent(CID, previewEvent);
    clearForm(CID);
    expect(getPendingTest(CID)).toBeNull();
  });

  it('hands a test dropped by a new form or a dismissed form to the server cancel', () => {
    const cancelled = [];
    setPendingTestCanceller((pending) => cancelled.push([pending.kind, pending.id]));
    try {
      setForm(CID, { form_id: 'fm_aaaaaaaaaa', title: 'Connect Planner' });
      applyConnectorTestEvent(CID, previewEvent);
      setForm(CID, { form_id: 'fm_aaaaaaaaaa', title: 'Connect Planner again' });
      applyConnectorTestEvent(CID, askEvent);
      clearForm(CID);

      setPendingTest('tmp-connect-2', pendingTestFromEvent(previewEvent));
      movePendingTest('tmp-connect-2', CID);
      clearPendingTest(CID);
    } finally {
      setPendingTestCanceller(null);
    }

    expect(cancelled).toEqual([['confirm', previewEvent.confirm_id], ['approval', askEvent.approval_id]]);
  });

  it('moves with its form when the server mints the conversation id, without a cancel', () => {
    const cancelled = [];
    setPendingTestCanceller((pending) => cancelled.push(pending.id));
    try {
      setForm('tmp-connect-3', { form_id: 'fm_aaaaaaaaaa', title: 'Connect Planner' });
      setSelectedMethod('tmp-connect-3', 'm1');
      applyConnectorTestEvent('tmp-connect-3', previewEvent);
      moveForm('tmp-connect-3', CID);
    } finally {
      setPendingTestCanceller(null);
    }

    expect(cancelled).toEqual([]);
    expect(getPendingTest(CID)?.id).toBe(previewEvent.confirm_id);
    expect(getForm(CID)?.form_id).toBe('fm_aaaaaaaaaa');
    expect(getSelectedMethod(CID)).toBe('m1');
    expect(getForm('tmp-connect-3')).toBeNull();
    expect(getPendingTest('tmp-connect-3')).toBeNull();
  });

  it('moves with the conversation when the server mints its id', () => {
    setPendingTest('tmp-connect-1', pendingTestFromEvent(previewEvent));
    movePendingTest('tmp-connect-1', CID);
    expect(getPendingTest('tmp-connect-1')).toBeNull();
    expect(getPendingTest(CID)?.id).toBe(previewEvent.confirm_id);
  });

  it('never reaches localStorage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    applyConnectorTestEvent(CID, previewEvent);
    expect(setItem.mock.calls.some((args) => String(args[1]).includes(previewEvent.confirm_id))).toBe(false);
    setItem.mockRestore();
  });
});

describe('the submission stream', () => {
  it('hands the preview event on before the stream completes', async () => {
    const body = fixture.stream.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join('');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const seen = [];
    await new Promise((resolve, reject) => {
      streamDataVaultSubmission({
        formId: 'fm_aaaaaaaaaa', formSpec: {}, values: {},
        onEvent: (ev) => seen.push(ev.type),
        onDone: resolve,
        onError: reject,
      });
    });
    expect(seen.indexOf('connector.test_preview')).toBeGreaterThan(-1);
    expect(seen.indexOf('connector.test_preview')).toBeLessThan(seen.indexOf('response.completed'));
  });
});
