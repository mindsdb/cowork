import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

vi.mock('../../api', () => ({ testDecisionModel: vi.fn() }));

import { testDecisionModel } from '../../api';
import DecisionModelSettingsGroup from './DecisionModelSettingsGroup';

const ADMIN = { canSetDecisionModel: true, decisions: null };

/* The Settings form's draft: what the group sets, it reads back. Another LLM
   provider than MindsHub unless a test says otherwise: on MindsHub there is
   nothing to set up. */
function Form({ initial, onSet = () => {} }) {
  const [settings, setSettings] = useState({ planningProvider: 'anthropic', ...initial });
  const setSetting = (key, value) => {
    onSet(key, value);
    setSettings((prev) => ({ ...prev, [key]: value }));
  };
  return <DecisionModelSettingsGroup settings={settings} setSetting={setSetting} agentLabel="Cowork" />;
}

describe('DecisionModelSettingsGroup', () => {
  beforeEach(() => {
    testDecisionModel.mockReset();
  });

  it('shows only to whoever may change it, as the server says', () => {
    for (const routing of [undefined, null, { decisions: 'own' }, { canSetDecisionModel: false }]) {
      const { container, unmount } = render(<Form initial={{ routing, decisionModelUrl: 'https://decide.example.test/d' }} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    render(<Form initial={{ routing: ADMIN }} />);
    expect(screen.getByText('Decision model')).toBeInTheDocument();
    expect(screen.getByText(/lets Cowork's browser pick its steps quickly when you don't use MindsHub/)).toBeInTheDocument();
  });

  it('on MindsHub says Jev runs there, with nothing to set up', () => {
    render(<Form initial={{ routing: ADMIN, planningProvider: 'minds-cloud' }} />);
    expect(screen.getByText('Jev on MindsHub Inference')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Learn more/ })).toHaveAttribute(
      'href', 'https://docs.mindshub.ai/inference/decision-models',
    );
    expect(screen.queryByLabelText('Endpoint URL')).not.toBeInTheDocument();
  });

  it('on MindsHub keeps the fields of a decision model the organization already set', () => {
    render(<Form initial={{ routing: ADMIN, planningProvider: 'minds-cloud', decisionModelUrl: 'https://decide.example.test/d' }} />);
    expect(screen.getByLabelText('Endpoint URL')).toHaveValue('https://decide.example.test/d');
    expect(screen.queryByText('Jev on MindsHub Inference')).not.toBeInTheDocument();
  });

  it('edits the endpoint, key and model name in the draft and tests them', async () => {
    const onSet = vi.fn();
    render(<Form initial={{ routing: ADMIN, decisionModelUrl: '', decisionModelApiKey: '', decisionModel: '' }} onSet={onSet} />);
    const test = screen.getByRole('button', { name: 'Test' });
    expect(test).toBeDisabled();
    expect(screen.getByLabelText('Model name')).toHaveAttribute('placeholder', 'jev');
    await userEvent.type(screen.getByLabelText('Endpoint URL'), 'https://decide.example.test/v1/systemone');
    await userEvent.type(screen.getByLabelText('API key'), 'own-key');
    await userEvent.type(screen.getByLabelText('Model name'), 'jev-own');
    expect(onSet).toHaveBeenCalledWith('decisionModelUrl', 'https://decide.example.test/v1/systemone');
    expect(onSet).toHaveBeenCalledWith('decisionModelApiKey', 'own-key');
    expect(onSet).toHaveBeenCalledWith('decisionModel', 'jev-own');

    testDecisionModel.mockResolvedValueOnce({ ok: true, error: null, ms: 42 });
    await userEvent.click(test);
    expect(await screen.findByText('It answered in 42 ms.')).toBeInTheDocument();
    expect(testDecisionModel).toHaveBeenLastCalledWith({
      url: 'https://decide.example.test/v1/systemone', apiKey: 'own-key', model: 'jev-own',
    });

    testDecisionModel.mockResolvedValueOnce({ ok: false, error: 'http_401', ms: 3 });
    await userEvent.click(test);
    expect(await screen.findByText(/didn't answer as expected \(http_401\)/)).toBeInTheDocument();

    testDecisionModel.mockRejectedValueOnce(new Error(''));
    await userEvent.click(test);
    expect(await screen.findByText("Couldn't test the decision model. Try again.")).toBeInTheDocument();
  });

  it('shows a saved key as saved, and tests it without revealing it', async () => {
    testDecisionModel.mockResolvedValue({ ok: true, error: null, ms: 5 });
    render(<Form initial={{ routing: ADMIN, decisionModelUrl: 'https://decide.example.test/d', decisionModelApiKey: '***', decisionModel: 'jev' }} />);
    const key = screen.getByLabelText('API key');
    expect(key).toHaveValue('');
    expect(key).toHaveAttribute('placeholder', 'Saved. Type to replace it.');
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(testDecisionModel).toHaveBeenCalledWith({ url: 'https://decide.example.test/d', apiKey: '***', model: 'jev' });
  });

  it('removes it in the draft, to save with the form', async () => {
    const onSet = vi.fn();
    render(<Form initial={{ routing: ADMIN, decisionModelUrl: 'https://decide.example.test/d', decisionModelApiKey: '***', decisionModel: 'jev-own' }} onSet={onSet} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onSet).toHaveBeenCalledWith('decisionModelUrl', '');
    expect(onSet).toHaveBeenCalledWith('decisionModelApiKey', '');
    expect(onSet).toHaveBeenCalledWith('decisionModel', 'jev');
    await waitFor(() => expect(screen.getByLabelText('Endpoint URL')).toHaveValue(''));
    expect(screen.getByLabelText('API key')).not.toHaveAttribute('placeholder', 'Saved. Type to replace it.');
    // Nothing left to remove.
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});
