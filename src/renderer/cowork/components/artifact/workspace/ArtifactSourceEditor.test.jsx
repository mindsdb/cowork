import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactSourceEditor } from './ArtifactSourceEditor';
import { HTML_VISUAL_EDITOR_SOURCE } from './htmlVisualEditorRuntime';

const SOURCE = {
  artifactId: 'artifact-1',
  path: 'deck.html',
  content: '<!doctype html><html><body><h1>Original title</h1></body></html>',
};

describe('ArtifactSourceEditor HTML mode', () => {
  it('opens on the artifact canvas and keeps source editing behind an advanced action', async () => {
    const user = userEvent.setup();
    render(
      <ArtifactSourceEditor
        source={SOURCE}
        value={SOURCE.content}
        onChange={vi.fn()}
        onSave={vi.fn()}
        draftUrl="https://draft.example/deck.html"
      />,
    );

    expect(screen.getByTitle('Edit artifact on canvas')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Edit deck.html' })).not.toBeInTheDocument();
    expect(screen.getByText('Preparing editable text…')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByRole('textbox', { name: 'Edit deck.html' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to artifact' }));
    expect(screen.getByTitle('Edit artifact on canvas')).toBeInTheDocument();
  });

  it('turns a trusted frame edit into a localized source update', () => {
    const onChange = vi.fn();
    render(
      <ArtifactSourceEditor
        source={SOURCE}
        value={SOURCE.content}
        onChange={onChange}
        onSave={vi.fn()}
        draftUrl="https://draft.example/deck.html"
      />,
    );

    const frame = screen.getByTitle('Edit artifact on canvas');
    const srcDoc = frame.getAttribute('srcdoc');
    const token = srcDoc.match(/const TOKEN = "([^"]+)"/)?.[1];
    expect(token).toBeTruthy();

    fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: {
        source: HTML_VISUAL_EDITOR_SOURCE,
        token,
        type: 'change',
        elementId: 'cowork-edit-0',
        html: 'Updated title',
      },
    }));

    expect(onChange).toHaveBeenCalledWith(
      '<!doctype html><html><body><h1>Updated title</h1></body></html>',
    );
  });

  it('accepts a valid token when an opaque Electron frame reports a different source proxy', () => {
    const onChange = vi.fn();
    render(
      <ArtifactSourceEditor
        source={SOURCE}
        value={SOURCE.content}
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );

    const frame = screen.getByTitle('Edit artifact on canvas');
    const token = frame.getAttribute('srcdoc').match(/const TOKEN = "([^"]+)"/)?.[1];
    fireEvent(window, new MessageEvent('message', {
      source: window,
      data: {
        source: HTML_VISUAL_EDITOR_SOURCE,
        token,
        type: 'change',
        elementId: 'cowork-edit-0',
        html: 'Updated from Electron',
      },
    }));

    expect(onChange).toHaveBeenCalledWith(
      '<!doctype html><html><body><h1>Updated from Electron</h1></body></html>',
    );
  });

  it('ignores messages that do not come from its own sandboxed frame', () => {
    const onChange = vi.fn();
    render(
      <ArtifactSourceEditor
        source={SOURCE}
        value={SOURCE.content}
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );

    fireEvent(window, new MessageEvent('message', {
      data: {
        source: HTML_VISUAL_EDITOR_SOURCE,
        token: 'forged',
        type: 'change',
        elementId: 'cowork-edit-0',
        html: 'Forged title',
      },
    }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('passes the latest visual draft to a keyboard save before React rerenders', () => {
    const onSave = vi.fn();
    render(
      <ArtifactSourceEditor
        source={SOURCE}
        value={SOURCE.content}
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );

    const frame = screen.getByTitle('Edit artifact on canvas');
    const token = frame.getAttribute('srcdoc').match(/const TOKEN = "([^"]+)"/)?.[1];
    fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: {
        source: HTML_VISUAL_EDITOR_SOURCE,
        token,
        type: 'change',
        elementId: 'cowork-edit-0',
        html: 'Latest title',
      },
    }));
    fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: { source: HTML_VISUAL_EDITOR_SOURCE, token, type: 'save' },
    }));

    expect(onSave).toHaveBeenCalledWith(
      '<!doctype html><html><body><h1>Latest title</h1></body></html>',
    );
  });
});
