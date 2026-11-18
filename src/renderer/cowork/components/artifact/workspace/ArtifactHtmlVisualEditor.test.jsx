import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  // Live edit's Navigate / Edit switch (ENG-4383).
  const modeMessages = (frame) => frame.contentWindow.postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message?.type === 'mode');

  it('starts in Edit, tells the page, and says any text can be edited', async () => {
    await renderReadyEditor();
    const frame = screen.getByTitle('Edit artifact on canvas');
    vi.spyOn(frame.contentWindow, 'postMessage');

    sendFromFrame({ token: frameToken(), type: 'ready', editableCount: 3 });

    expect(screen.getByRole('button', { name: /Edit text/ })).toHaveAttribute('aria-pressed', 'true');
    expect(modeMessages(frame).at(-1)).toMatchObject({ mode: 'edit' });
    expect(screen.getByText('Click any text to edit it, including buttons and links.')).toBeInTheDocument();
  });

  it('switches to Navigate and back, telling the page each time', async () => {
    await renderReadyEditor();
    const frame = screen.getByTitle('Edit artifact on canvas');
    vi.spyOn(frame.contentWindow, 'postMessage');
    sendFromFrame({ token: frameToken(), type: 'ready', editableCount: 3 });

    fireEvent.click(screen.getByRole('button', { name: /Navigate/ }));
    expect(modeMessages(frame).at(-1)).toMatchObject({ mode: 'navigate' });
    expect(screen.getByRole('button', { name: /Navigate/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/^Navigating\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Edit text/ }));
    expect(modeMessages(frame).at(-1)).toMatchObject({ mode: 'edit' });
  });

  it('tells a rebuilt page the mode it was in', async () => {
    await renderReadyEditor();
    const frame = screen.getByTitle('Edit artifact on canvas');
    vi.spyOn(frame.contentWindow, 'postMessage');
    sendFromFrame({ token: frameToken(), type: 'ready', editableCount: 3 });
    fireEvent.click(screen.getByRole('button', { name: /Navigate/ }));
    frame.contentWindow.postMessage.mockClear();

    sendFromFrame({ token: frameToken(), type: 'ready', editableCount: 3 });

    expect(modeMessages(frame)).toEqual([expect.objectContaining({ mode: 'navigate' })]);
  });

  it('offers no switch when nothing on the page can be edited', async () => {
    await renderReadyEditor();
    sendFromFrame({ token: frameToken(), type: 'ready', editableCount: 0 });
    expect(screen.queryByRole('toolbar', { name: 'Live edit mode' })).toBeNull();
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

describe('ArtifactHtmlVisualEditor opening on the preview view', () => {
  const VIEW = {
    hash: '',
    scrollX: 0,
    scrollY: 0,
    container: null,
    inputs: [{ type: 'key', key: 'ArrowRight', shiftKey: false }],
    overflow: false,
    heading: 'Slide 3',
  };
  let posted;

  beforeEach(() => {
    // Each canvas frame gets its own stand-in window, so a test can tell
    // which frame the view went to.
    posted = new Map();
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function contentWindow() {
      if (!posted.has(this)) posted.set(this, { postMessage: vi.fn() });
      return posted.get(this);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function Harness({ active, previewView }) {
    const [value, setValue] = useState(VALUE);
    return (
      <ArtifactHtmlVisualEditor
        source={SOURCE}
        value={value}
        onChange={setValue}
        onSave={vi.fn()}
        draftUrl={DRAFT_URL}
        active={active}
        previewView={previewView}
      />
    );
  }

  const canvas = () => screen.getByTitle('Edit artifact on canvas');
  const viewsSentTo = (frame) => (posted.get(frame)?.postMessage.mock.calls || [])
    .map(([message]) => message)
    .filter((message) => message.type === 'view');
  const ready = () => sendFromFrame({ token: frameToken(), type: 'ready', editableCount: 1, interactiveCount: 0 });

  it('sends the preview\'s view to a fresh canvas when Edit opens', async () => {
    const rendered = render(<Harness active={false} previewView={{ view: VIEW, seq: 1 }} />);
    const frame = await screen.findByTitle('Edit artifact on canvas');
    ready();
    // Prepared behind the Preview: nothing is replayed until Edit is opened.
    expect(viewsSentTo(frame)).toEqual([]);

    rendered.rerender(<Harness active previewView={{ view: VIEW, seq: 1 }} />);

    expect(canvas()).toBe(frame);
    expect(viewsSentTo(frame)).toEqual([
      { source: 'cowork-artifact-visual-editor-parent', type: 'view', view: VIEW },
    ]);
    expect(screen.getByText('Opening where you were in Preview…')).toBeInTheDocument();

    sendFromFrame({ token: frameToken(), type: 'view-applied', status: 'ok' });
    expect(screen.queryByText('Opening where you were in Preview…')).not.toBeInTheDocument();
    expect(canvas()).toBe(frame);
  });

  it('ignores a view-applied report with another token', async () => {
    const rendered = render(<Harness active={false} previewView={{ view: VIEW, seq: 1 }} />);
    const frame = await screen.findByTitle('Edit artifact on canvas');
    ready();
    rendered.rerender(<Harness active previewView={{ view: VIEW, seq: 1 }} />);

    sendFromFrame({ token: 'forged', type: 'view-applied', status: 'mismatch' });

    expect(canvas()).toBe(frame);
    expect(screen.getByText('Opening where you were in Preview…')).toBeInTheDocument();
  });

  it('starts over from a fresh canvas when the replay missed the slide', async () => {
    render(<Harness active previewView={{ view: VIEW, seq: 1 }} />);
    const frame = await screen.findByTitle('Edit artifact on canvas');
    ready();
    expect(viewsSentTo(frame)).toHaveLength(1);

    sendFromFrame({ token: frameToken(), type: 'view-applied', status: 'mismatch' });

    const rebuilt = await screen.findByTitle('Edit artifact on canvas');
    expect(rebuilt).not.toBe(frame);
    ready();
    expect(viewsSentTo(rebuilt)).toEqual([]);
  });

  it('rebuilds a canvas the user may have moved before replaying a new view', async () => {
    const rendered = render(<Harness active previewView={{ view: null, seq: 0 }} />);
    const frame = await screen.findByTitle('Edit artifact on canvas');
    ready();

    // Back to Preview, the user moves it, then opens Edit again.
    rendered.rerender(<Harness active={false} previewView={{ view: VIEW, seq: 1 }} />);
    rendered.rerender(<Harness active previewView={{ view: VIEW, seq: 1 }} />);

    const rebuilt = await screen.findByTitle('Edit artifact on canvas');
    expect(rebuilt).not.toBe(frame);
    expect(viewsSentTo(frame)).toEqual([]);
    ready();
    expect(viewsSentTo(rebuilt)).toHaveLength(1);
  });

  it('keeps the canvas where it is when the preview has not moved since', async () => {
    const rendered = render(<Harness active previewView={{ view: VIEW, seq: 1 }} />);
    const frame = await screen.findByTitle('Edit artifact on canvas');
    ready();
    sendFromFrame({ token: frameToken(), type: 'view-applied', status: 'ok' });

    rendered.rerender(<Harness active={false} previewView={{ view: VIEW, seq: 1 }} />);
    rendered.rerender(<Harness active previewView={{ view: VIEW, seq: 1 }} />);
    // A save reloads the preview: back at its start, but not moved by the user.
    rendered.rerender(<Harness active previewView={{ view: null, seq: 2 }} />);

    expect(canvas()).toBe(frame);
    expect(viewsSentTo(frame)).toHaveLength(1);
  });

  // Keeping its own place across a rebuild (ENG-4383): a quick edit, an
  // agent change, a save or a discard replaces the content under the canvas.
  function Controlled({ value, onViewChange = vi.fn() }) {
    return (
      <ArtifactHtmlVisualEditor
        source={SOURCE}
        value={value}
        onChange={vi.fn()}
        onSave={vi.fn()}
        draftUrl={DRAFT_URL}
        active
        previewView={{ view: null, seq: 0 }}
        onViewChange={onViewChange}
      />
    );
  }
  const CHANGED = VALUE.replace('Title', 'New title');

  it('replays its own place into a canvas rebuilt because the content changed', async () => {
    const onViewChange = vi.fn();
    const rendered = render(<Controlled value={VALUE} onViewChange={onViewChange} />);
    const frame = await screen.findByTitle('Edit artifact on canvas');
    ready();
    sendFromFrame({ token: frameToken(), type: 'view', view: VIEW });
    expect(onViewChange).toHaveBeenLastCalledWith({
      hash: '', scrollX: 0, scrollY: 0, container: null, inputs: VIEW.inputs, overflow: false, heading: 'Slide 3',
    });

    rendered.rerender(<Controlled value={CHANGED} onViewChange={onViewChange} />);

    const rebuilt = await screen.findByTitle('Edit artifact on canvas');
    expect(rebuilt).not.toBe(frame);
    ready();
    const [sent] = viewsSentTo(rebuilt);
    expect(sent.view).toMatchObject({ inputs: VIEW.inputs, heading: 'Slide 3' });
    expect(screen.getByText('Going back to where you were…')).toBeInTheDocument();
    sendFromFrame({ token: frameToken(), type: 'view-applied', status: 'ok' });
    expect(screen.queryByText('Going back to where you were…')).not.toBeInTheDocument();
  });

  it('replays nothing into a rebuilt canvas the user never moved', async () => {
    const rendered = render(<Controlled value={VALUE} />);
    await screen.findByTitle('Edit artifact on canvas');
    ready();
    rendered.rerender(<Controlled value={CHANGED} />);
    const rebuilt = await screen.findByTitle('Edit artifact on canvas');
    ready();
    expect(viewsSentTo(rebuilt)).toEqual([]);
  });

  it('takes no place from the canvas that it would not take from the Preview', async () => {
    const onViewChange = vi.fn();
    const rendered = render(<Controlled value={VALUE} onViewChange={onViewChange} />);
    await screen.findByTitle('Edit artifact on canvas');
    ready();
    sendFromFrame({ token: frameToken(), type: 'view', view: { ...VIEW, inputs: [{ type: 'key', key: 'Delete' }] } });
    sendFromFrame({ token: 'forged', type: 'view', view: VIEW });
    expect(onViewChange).not.toHaveBeenCalled();

    rendered.rerender(<Controlled value={CHANGED} onViewChange={onViewChange} />);
    const rebuilt = await screen.findByTitle('Edit artifact on canvas');
    ready();
    expect(viewsSentTo(rebuilt)).toEqual([]);
  });

  it('keeps its place when a discard puts the saved source back', async () => {
    // The draft follows the canvas's edits (onChange), and Discard sets it
    // back to the saved source, as useArtifactWorkspace.discard does.
    function Discardable() {
      const [value, setValue] = useState(VALUE);
      return (
        <>
          <button type="button" onClick={() => setValue(VALUE)}>Discard</button>
          <ArtifactHtmlVisualEditor
            source={SOURCE}
            value={value}
            onChange={setValue}
            onSave={vi.fn()}
            draftUrl={DRAFT_URL}
            active
            previewView={{ view: null, seq: 0 }}
          />
        </>
      );
    }
    render(<Discardable />);
    const frame = await screen.findByTitle('Edit artifact on canvas');
    ready();
    sendFromFrame({ token: frameToken(), type: 'view', view: VIEW });
    sendFromFrame({ token: frameToken(), type: 'change', elementId: 'cowork-edit-0', html: 'Typed' });
    // Typing in the canvas does not rebuild it.
    expect(canvas()).toBe(frame);

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    const rebuilt = await screen.findByTitle('Edit artifact on canvas');
    expect(rebuilt).not.toBe(frame);
    ready();
    expect(viewsSentTo(rebuilt)).toHaveLength(1);
    expect(viewsSentTo(rebuilt)[0].view).toMatchObject({ inputs: VIEW.inputs, heading: 'Slide 3' });
  });

  it('forgets its place after a replay that missed, so it does not loop', async () => {
    const rendered = render(<Controlled value={VALUE} />);
    await screen.findByTitle('Edit artifact on canvas');
    ready();
    sendFromFrame({ token: frameToken(), type: 'view', view: VIEW });
    rendered.rerender(<Controlled value={CHANGED} />);
    const rebuilt = await screen.findByTitle('Edit artifact on canvas');
    ready();
    expect(viewsSentTo(rebuilt)).toHaveLength(1);

    sendFromFrame({ token: frameToken(), type: 'view-applied', status: 'mismatch' });

    const fresh = await screen.findByTitle('Edit artifact on canvas');
    expect(fresh).not.toBe(rebuilt);
    ready();
    expect(viewsSentTo(fresh)).toEqual([]);
  });
});

// With the viewer's toolbar hidden, the editor carries its own way out of
// Live edit, beside Advanced (ENG-4383).
describe('ArtifactHtmlVisualEditor exit', () => {
  it('offers Exit Live edit when given a way out, and calls it', async () => {
    const onExit = vi.fn();
    render(
      <ArtifactHtmlVisualEditor source={SOURCE} value={VALUE} onChange={vi.fn()} onSave={vi.fn()} draftUrl={DRAFT_URL} onExit={onExit} />,
    );
    await screen.findByTitle('Edit artifact on canvas');

    fireEvent.click(screen.getByRole('button', { name: /Exit Live edit/ }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('has no exit while the toolbar shows the Live edit toggle', async () => {
    await renderReadyEditor();

    expect(screen.queryByRole('button', { name: /Exit Live edit/ })).toBeNull();
  });
});

// Live edit's Save and Discard sit right of Advanced and before Exit, only
// while there is unsaved text; there is no Done button (ENG-4383).
describe('ArtifactHtmlVisualEditor save and discard', () => {
  function renderWith(editActions, extra = {}) {
    render(
      <ArtifactHtmlVisualEditor
        source={SOURCE} value={VALUE} onChange={vi.fn()} onSave={vi.fn()} draftUrl={DRAFT_URL}
        editActions={editActions} {...extra}
      />,
    );
    return screen.findByTitle('Edit artifact on canvas');
  }

  it('shows Discard and Save in order after Advanced and before Exit, and runs them', async () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    await renderWith({ dirty: true, saving: false, canEdit: true, onSave, onDiscard }, { onExit: vi.fn() });

    const labels = [...document.querySelectorAll('.artifact-html-edit-actions button')].map((b) => b.textContent.trim());
    expect(labels).toEqual(['Advanced', 'Discard', 'Save', 'Exit Live edit']);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('shows neither with nothing unsaved, and never a Done button', async () => {
    await renderWith({ dirty: false, saving: false, canEdit: true, onSave: vi.fn(), onDiscard: vi.fn() });
    sendFromFrame({ token: frameToken(), type: 'selection', elementId: 'cowork-edit-0', label: 'Heading' });

    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Done/ })).toBeNull();
  });

  it('holds Save while saving', async () => {
    await renderWith({ dirty: true, saving: true, canEdit: true, onSave: vi.fn(), onDiscard: vi.fn() });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
