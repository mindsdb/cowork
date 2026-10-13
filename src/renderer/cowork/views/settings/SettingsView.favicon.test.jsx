import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const deployment = vi.hoisted(() => ({ isWeb: true }));
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  fetchRecommendedModels: vi.fn(async () => ({})),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    get isWeb() { return deployment.isWeb; },
    get isElectron() { return !deployment.isWeb; },
    isMac: () => false,
    openExternal: vi.fn(),
    getKeychainPref: vi.fn(async () => false),
  },
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
  isElectron: false,
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../../lib/analytics', () => ({ resetDeviceIdentity: vi.fn() }));
import SettingsView from './SettingsView';

const PNG = 'data:image/png;base64,aWNvbg==';
function Harness({ onSave, onAppearancePreview = vi.fn(), initial = '' }) {
  const [settings, setSettings] = useState({ favicon: initial });
  const [open, setOpen] = useState(true);
  return <>
    <button onClick={() => setOpen((value) => !value)}>Toggle settings</button>
    {open && <SettingsView settings={settings} section="appearance"
      onSave={async (patch) => { await onSave(patch); setSettings((previous) => ({ ...previous, ...patch })); }}
      onAppearancePreview={onAppearancePreview}
      theme="dark" skin="default" customTheme={{}} agentLabel="Anton" serverOnline />}
  </>;
}

const upload = (file) => fireEvent.change(screen.getByLabelText('Browser tab icon file'), { target: { files: [file] } });
beforeEach(() => { deployment.isWeb = true; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Browser tab icon settings', () => {
  it.each([
    ['png', 'image/png'], ['ico', 'image/x-icon'], ['ico', 'image/vnd.microsoft.icon'],
    ['svg', 'image/svg+xml'], ['webp', 'image/webp'], ['ico', ''],
  ])('previews and persists %s (%s), then removes it', async (extension, mime) => {
    const save = vi.fn(async () => {});
    const preview = vi.fn();
    render(<Harness onSave={save} onAppearancePreview={preview} />);
    upload(new File(['icon'], `icon.${extension}`, { type: mime }));
    const expected = `data:${mime || 'image/x-icon'};base64,aWNvbg==`;
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith({ favicon: expected }));
    expect(preview).toHaveBeenCalledWith('favicon', expected);
    expect(screen.getByAltText('Browser tab icon preview')).toHaveAttribute('src', expected);
    fireEvent.click(screen.getByRole('button', { name: 'Remove browser tab icon' }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ favicon: '' }));
    expect(preview).toHaveBeenCalledWith('favicon', '');
    expect(screen.queryByAltText('Browser tab icon preview')).toBeNull();
  });

  it('updates the preview before persistence finishes and preserves it after reopen', async () => {
    let finish;
    const save = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    render(<Harness onSave={save} />);
    upload(new File(['icon'], 'icon.png', { type: 'image/png' }));
    expect(await screen.findByAltText('Browser tab icon preview')).toHaveAttribute('src', PNG);
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    await act(async () => finish());
    fireEvent.click(screen.getByRole('button', { name: 'Toggle settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle settings' }));
    expect(screen.getByAltText('Browser tab icon preview')).toHaveAttribute('src', PNG);
  });

  it.each([100 * 1024, 100 * 1024 + 1])('rejects %i bytes without altering the current icon or saving', async (size) => {
    const save = vi.fn();
    const preview = vi.fn();
    render(<Harness onSave={save} onAppearancePreview={preview} initial={PNG} />);
    upload(new File([new Uint8Array(size)], 'large.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('under 100 KB');
    expect(screen.getByAltText('Browser tab icon preview')).toHaveAttribute('src', PNG);
    expect(save).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
  });

  it('accepts one byte below the size limit', async () => {
    const save = vi.fn(async () => {});
    render(<Harness onSave={save} />);
    upload(new File([new Uint8Array(100 * 1024 - 1)], 'icon.png', { type: 'image/png' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([['image/jpeg', 'icon.jpg'], ['text/html', 'icon.png'], ['', 'icon.txt']])('rejects unsupported %s content without saving', (type, name) => {
    const save = vi.fn();
    render(<Harness onSave={save} initial={PNG} />);
    upload(new File(['icon'], name, { type }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a PNG, ICO, SVG, or WEBP image.');
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByAltText('Browser tab icon preview')).toHaveAttribute('src', PNG);
  });

  it.each(['event', 'throw'])('reports a file read failure (%s) without saving', async (failure) => {
    vi.stubGlobal('FileReader', class {
      readAsDataURL() { if (failure === 'throw') throw new Error('read failed'); this.onerror(); }
      abort() {}
    });
    const save = vi.fn();
    render(<Harness onSave={save} />);
    upload(new File(['icon'], 'icon.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't read this image");
    expect(save).not.toHaveBeenCalled();
  });

  it('shows a failed save and discards the unconfirmed preview on close', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const preview = vi.fn();
    render(<Harness onSave={vi.fn(async () => { throw new Error('offline'); })} onAppearancePreview={preview} />);
    upload(new File(['icon'], 'icon.png', { type: 'image/png' }));
    await screen.findByText("Couldn't save");
    expect(screen.getByAltText('Browser tab icon preview')).toHaveAttribute('src', PNG);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle settings' }));
    expect(preview).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle settings' }));
    expect(screen.queryByAltText('Browser tab icon preview')).toBeNull();
  });

  it('hides the control on desktop', () => {
    deployment.isWeb = false;
    render(<Harness onSave={vi.fn()} initial={PNG} />);
    expect(screen.queryByText('Browser tab icon')).toBeNull();
    expect(screen.queryByLabelText('Browser tab icon file')).toBeNull();
    expect(screen.getByText('Sidebar logo')).toBeInTheDocument();
  });
});
