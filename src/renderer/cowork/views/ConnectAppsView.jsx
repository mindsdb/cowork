import { useState, useEffect, useRef } from 'react';
import Ico from '../components/Icons';
import {
  fetchIntegrations,
  startGoogleDriveAuth, disconnectGoogleDrive,
} from '../api';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS  = 2 * 60 * 1000;

function GoogleDriveLogo({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 27h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  );
}

function AppTile({ title, logo, description, status, connecting, onConnect, onDisconnect }) {
  const isConnected = status === 'connected';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '20px 24px',
      borderRadius: 10,
      background: 'var(--surface-glass)',
      border: '1px solid var(--border-subtle)',
      maxWidth: 520,
    }}>
      <div style={{ flexShrink: 0 }}>{logo}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-strong)', marginBottom: 3 }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          {description}
        </div>
      </div>

      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        {isConnected ? (
          <>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--success)',
              background: 'rgba(34,160,94,0.1)',
              border: '1px solid rgba(34,160,94,0.25)',
              borderRadius: 20,
              padding: '4px 10px',
            }}>
              {Ico.check(12)} Connected
            </span>
            <button
              className="btn"
              onClick={onDisconnect}
              style={{ fontSize: 12, padding: '4px 12px' }}
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary"
            onClick={onConnect}
            disabled={connecting}
            style={{ fontSize: 13, padding: '6px 16px', opacity: connecting ? 0.7 : 1 }}
          >
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ConnectAppsView() {
  const [integrations, setIntegrations]   = useState([]);
  const [connectingId, setConnectingId]   = useState(null);
  const [error, setError]                 = useState(null);
  const pollRef = useRef(null);

  const load = async () => {
    try {
      const data  = await fetchIntegrations();
      const items = data?.items || [];
      setIntegrations(items);
      return items;
    } catch {
      return integrations;
    }
  };

  useEffect(() => {
    load();
    return () => clearInterval(pollRef.current);
  }, []);

  const handleConnect = async (integrationId, startAuth) => {
    setError(null);
    try {
      const result = await startAuth();
      if (!result?.authUrl) {
        setError('Could not start auth. Is the server running?');
        return;
      }
      window.open(result.authUrl, '_blank');
      const startedAt = result.startedAt || '';
      setConnectingId(integrationId);

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      pollRef.current = setInterval(async () => {
        if (Date.now() > deadline) {
          clearInterval(pollRef.current);
          setConnectingId(null);
          return;
        }
        const items = await load();
        const item  = items.find((i) => i.id === integrationId);
        const lastSuccessAt = item?.oauth?.lastSuccessAt || '';
        if (lastSuccessAt && (!startedAt || lastSuccessAt >= startedAt)) {
          clearInterval(pollRef.current);
          setConnectingId(null);
        }
      }, POLL_INTERVAL_MS);
    } catch (e) {
      setError(e?.message || 'Something went wrong.');
      setConnectingId(null);
    }
  };

  const handleDisconnect = async (integrationId, disconnectFn) => {
    clearInterval(pollRef.current);
    setConnectingId(null);
    setError(null);
    setIntegrations((prev) =>
      prev.map((i) => i.id === integrationId
        ? { ...i, status: 'available', connections: [], connectionCount: 0 }
        : i)
    );
    try {
      await disconnectFn();
      await load();
    } catch (e) {
      setError(e?.message || 'Disconnect failed.');
      await load();
    }
  };

  const gdrive = integrations.find((i) => i.id === 'google_drive');

  return (
    <div style={{ padding: '32px 40px', height: '100%', overflowY: 'auto' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', margin: 0, marginBottom: 6 }}>
          Connect Apps
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Connect external apps so Anton can access and work with your data.
        </p>
      </div>

      {error && (
        <div style={{
          marginBottom: 20,
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgba(255,82,82,0.1)',
          border: '1px solid rgba(255,82,82,0.25)',
          color: 'var(--danger)',
          fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <AppTile
          title="Google Drive"
          logo={<GoogleDriveLogo size={40} />}
          description="Access your Drive files so Anton can read, create, and manage Drive files, Docs, and Sheets."
          status={gdrive?.status}
          connecting={connectingId === 'google_drive'}
          onConnect={() => handleConnect('google_drive', startGoogleDriveAuth)}
          onDisconnect={() => handleDisconnect('google_drive', disconnectGoogleDrive)}
        />
      </div>
    </div>
  );
}
