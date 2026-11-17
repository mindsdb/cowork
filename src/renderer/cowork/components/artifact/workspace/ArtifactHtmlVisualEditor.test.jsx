import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inlineHtmlFromApi } from '../../../lib/inlineHtmlAssets';
import { ArtifactHtmlVisualEditor } from './ArtifactHtmlVisualEditor';
import { HTML_VISUAL_EDITOR_SOURCE } from './htmlVisualEditorRuntime';

vi.mock('../../../../platform/host', () => ({
  host: { getApiOrigin: () => 'http://127.0.0.1:4000' },
}));
vi.mock('../../../lib/inlineHtmlAssets', () => ({ inlineHtmlFromApi: vi.fn() }));

const DRAFT_URL = '/api/v1/artifacts/drafts/p/a/index.html';
const SOURCE = { path: 'index.html', contentType: 'html' };
const VALUE = '<html><head></head><body><h1>Title</h1><img src="local.png"></body></html>';
const INLINED_IMAGE = 'data:image/png;base64,AA';

function inlineImage(html) {
  return html.replace('local.png', INLINED_IMAGE);
}

function renderEditor() {
  const onChange = vi.fn();
  render(
    <ArtifactHtmlVisualEditor
      source={SOURCE}
      value={VALUE}
      onChange={onChange}
      onSave={vi.fn()}
      draftUrl={DRAFT_URL}
    />,
  );
  return { onChange };
}

async function renderReadyEditor() {
  const result = renderEditor();
  await screen.findByTitle('Edit artifact on canvas');
  return result;
}

function frameDocument() {
  return screen.getByTitle('Edit artifact on canvas').getAttribute('srcdoc');
}

function frameToken() {
  return frameDocument().match(/const TOKEN = "([^"]+)"/)[1];
}

function sendFromFrame(message) {
  fireEvent(window, new MessageEvent('message', {
    data: { source: HTML_VISUAL_EDITOR_SOURCE, ...message },
  }));
}

beforeEach(() => {
  inlineHtmlFromApi.mockReset();
  inlineHtmlFromApi.mockImplementation(async (html) => inlineImage(html));
});

describe('ArtifactHtmlVisualEditor folder files', () => {
  it('shows no frame until the folder files are inlined', async () => {
    let finish;
    inlineHtmlFromApi.mockImplementation((html) => new Promise((resolve) => {
      finish = () => resolve(inlineImage(html));
    }));

    renderEditor();
    expect(screen.queryByTitle('Edit artifact on canvas')).not.toBeInTheDocument();
    expect(screen.getByText('Preparing editable text…')).toBeInTheDocument();

    await act(async () => { finish(); });
    expect(frameDocument()).toContain(`src="${INLINED_IMAGE}"`);
  });

  it('bases the document and the inlining on the API origin', async () => {
    await renderReadyEditor();

    expect(frameDocument()).toContain(
      '<base href="http://127.0.0.1:4000/api/v1/artifacts/drafts/p/a/index.html">',
    );
    expect(inlineHtmlFromApi).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      rootUrl: 'http://127.0.0.1:4000/api/v1/artifacts/drafts/p/a/',
      filePath: 'index.html',
    }));
  });

  it('applies a change from the inlined frame to the source', async () => {
    const { onChange } = await renderReadyEditor();

    sendFromFrame({ token: frameToken(), type: 'change', elementId: 'cowork-edit-0', html: 'New title' });

    expect(onChange).toHaveBeenLastCalledWith(VALUE.replace('Title', 'New title'));
  });
});

describe('ArtifactHtmlVisualEditor cancel', () => {
  it('restores the source on cancel after a change', async () => {
    const { onChange } = await renderReadyEditor();
    const token = frameToken();

    sendFromFrame({ token, type: 'selection', elementId: 'cowork-edit-0', label: 'Heading' });
    sendFromFrame({ token, type: 'change', elementId: 'cowork-edit-0', html: 'Typed' });
    sendFromFrame({ token, type: 'cancel', elementId: 'cowork-edit-0' });

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(VALUE);
  });

  it('changes nothing on cancel without a change', async () => {
    const { onChange } = await renderReadyEditor();
    const token = frameToken();

    sendFromFrame({ token, type: 'selection', elementId: 'cowork-edit-0', label: 'Heading' });
    sendFromFrame({ token, type: 'cancel', elementId: 'cowork-edit-0' });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores a cancel with another token or for another element', async () => {
    const { onChange } = await renderReadyEditor();
    const token = frameToken();

    sendFromFrame({ token, type: 'selection', elementId: 'cowork-edit-0', label: 'Heading' });
    sendFromFrame({ token, type: 'change', elementId: 'cowork-edit-0', html: 'Typed' });
    sendFromFrame({ token: 'forged', type: 'cancel', elementId: 'cowork-edit-0' });
    sendFromFrame({ token, type: 'cancel', elementId: 'cowork-edit-1' });

    expect(onChange).toHaveBeenCalledTimes(1);

    sendFromFrame({ token, type: 'cancel', elementId: 'cowork-edit-0' });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(VALUE);
  });

  it('replaces the snapshot when another element is selected', async () => {
    const { onChange } = await renderReadyEditor();
    const token = frameToken();

    sendFromFrame({ token, type: 'selection', elementId: 'cowork-edit-0', label: 'Heading' });
    sendFromFrame({ token, type: 'change', elementId: 'cowork-edit-0', html: 'Typed' });
    sendFromFrame({ token, type: 'selection', elementId: 'cowork-edit-1', label: 'Paragraph' });
    sendFromFrame({ token, type: 'cancel', elementId: 'cowork-edit-0' });

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('ArtifactHtmlVisualEditor multi-view pages', () => {
  function ControlledEditor() {
    const [value, setValue] = useState(VALUE);
    return (
      <ArtifactHtmlVisualEditor
        source={SOURCE}
        value={value}
        onChange={setValue}
        onSave={vi.fn()}
        draftUrl={DRAFT_URL}
      />
    );
  }

  async function renderControlled() {
    render(<ControlledEditor />);
    return screen.findByTitle('Edit artifact on canvas');
  }

  it('says buttons and links still work when the page has any', async () => {
    await renderReadyEditor();

    sendFromFrame({ token: frameToken(), type: 'ready', editableCount: 3, interactiveCount: 1 });

    expect(screen.getByText(/Buttons and links still work/)).toBeInTheDocument();
  });

  it('keeps the plain hint when no editable text is a control', async () => {
    await renderReadyEditor();

    sendFromFrame({ token: frameToken(), type: 'ready', editableCount: 3, interactiveCount: 0 });

    expect(screen.getByText('Click any text in the artifact to edit it')).toBeInTheDocument();
  });

  it('keeps the canvas, and the slide it is on, across a look at the source', async () => {
    const frame = await renderControlled();

    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(frame).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));

    expect(screen.getByTitle('Edit artifact on canvas')).toBe(frame);
  });

  it('rebuilds the canvas when the source was changed by hand', async () => {
    const frame = await renderControlled();

    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: VALUE.replace('Title', 'Typed') } });
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));

    const rebuilt = await screen.findByTitle('Edit artifact on canvas');
    expect(rebuilt).not.toBe(frame);
    expect(rebuilt.getAttribute('srcdoc')).toContain('Typed');
  });

  it('keeps the canvas after an edit made on it', async () => {
    const frame = await renderControlled();

    sendFromFrame({ token: frameToken(), type: 'change', elementId: 'cowork-edit-0', html: 'Edited' });
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));

    expect(screen.getByTitle('Edit artifact on canvas')).toBe(frame);
  });
});
