import { useEffect, useMemo, useState } from 'react';
import Ico from '../components/Icons';
import {
  fetchIntegrations,
  startGoogleDriveAuth,
} from '../api';

const PAGE_HOME = 'home';
const PAGE_CONNECTORS = 'connectors';

const DIRECTORY_MODE_CONNECTORS = 'connectors';
const DIRECTORY_MODE_PLUGINS = 'plugins';
const DESKTOP_CONNECTOR_IDS = ['anton_chrome', 'control_chrome', 'filesystem'];
const EXTERNAL_CONNECTOR_IDS = ['github', 'google_drive', 'miro', 'asana', 'cloudflare', 'figma', 'gmail', 'hubspot', 'linear', 'notion', 'posthog', 'slack', 'supabase', 'zoominfo'];

const CONNECTOR_LIBRARY = {
  github: {
    id: 'github',
    name: 'GitHub Integration',
    directory: false,
    description: 'Browse repositories, issues, pull requests, and discussions with GitHub context.',
    style: 'github',
    status: 'planned',
    action: 'Connect',
  },
  google_drive: {
    id: 'google_drive',
    name: 'Google Drive',
    directory: true,
    description: 'Connect your Google Drive account with Google sign-in so Anton can work with Drive files, Docs, and Sheets.',
    style: 'google-drive',
    status: 'planned',
    action: 'Connect',
  },
  miro: {
    id: 'miro',
    name: 'Miro',
    directory: true,
    description: 'Access and create new content on Miro boards.',
    style: 'miro',
    status: 'planned',
    action: 'Connect',
  },
  anton_chrome: {
    id: 'anton_chrome',
    name: 'Anton in Chrome',
    description: 'Anton ships desktop browser control directly in the app runtime.',
    style: 'anton',
    status: 'included',
    chip: 'Included',
    action: 'Available',
  },
  control_chrome: {
    id: 'control_chrome',
    name: 'Control Chrome',
    description: 'Drive the browser for local tasks and web workflows.',
    style: 'chrome',
    status: 'included',
    action: 'Available',
  },
  filesystem: {
    id: 'filesystem',
    name: 'filesystem',
    description: 'Local development file access for project work.',
    style: 'filesystem',
    status: 'included',
    chip: 'Local Dev',
    action: 'Available',
  },
  asana: {
    id: 'asana',
    name: 'Asana',
    description: 'Connect to Asana to coordinate tasks, projects, and goals.',
    style: 'asana',
    status: 'planned',
    action: 'Connect',
    interactive: true,
  },
  cloudflare: {
    id: 'cloudflare',
    name: 'Cloudflare Developer Platform',
    description: 'Work with Cloudflare services and developer workflows.',
    style: 'cloudflare',
    status: 'planned',
    action: 'Connect',
  },
  figma: {
    id: 'figma',
    name: 'Figma',
    description: 'Generate diagrams and better code from Figma context.',
    style: 'figma',
    status: 'planned',
    action: 'Connect',
  },
  gmail: {
    id: 'gmail',
    name: 'Gmail',
    description: 'Draft replies, summarize threads, and search your inbox.',
    style: 'gmail',
    status: 'planned',
    action: 'Connect',
  },
  google_calendar: {
    id: 'google_calendar',
    name: 'Google Calendar',
    description: 'Manage your schedule and coordinate meetings effortlessly.',
    style: 'calendar',
    status: 'planned',
    action: 'Connect',
  },
  hubspot: {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Chat with your CRM data to get personalized insights.',
    style: 'hubspot',
    status: 'planned',
    action: 'Connect',
  },
  linear: {
    id: 'linear',
    name: 'Linear',
    description: 'Manage issues, projects, and team workflows in Linear.',
    style: 'linear',
    status: 'planned',
    action: 'Connect',
  },
  notion: {
    id: 'notion',
    name: 'Notion',
    description: 'Connect your workspace to search, update, and power workflows across tools.',
    style: 'notion',
    status: 'planned',
    action: 'Connect',
  },
  posthog: {
    id: 'posthog',
    name: 'PostHog',
    description: 'Use product analytics and warehouse data with Anton.',
    style: 'posthog',
    status: 'planned',
    action: 'Connect',
  },
  slack: {
    id: 'slack',
    name: 'Slack',
    description: 'Send messages, create canvases, and fetch Slack data.',
    style: 'slack',
    status: 'planned',
    action: 'Connect',
  },
  supabase: {
    id: 'supabase',
    name: 'Supabase',
    description: 'Access data, auth, and storage in Supabase projects.',
    style: 'supabase',
    status: 'planned',
    action: 'Connect',
  },
  zoominfo: {
    id: 'zoominfo',
    name: 'ZoomInfo',
    description: 'Work with go-to-market contact and company data.',
    style: 'zoominfo',
    status: 'planned',
    action: 'Connect',
  },
};

const DIRECTORY_CONNECTOR_CARDS = [
  { id: 'gmail', popularity: '#2 popular', desc: 'Draft replies, summarize threads, & search your inbox', action: 'add' },
  { id: 'google_drive', popularity: 'Most popular', desc: 'Search, read, and upload files instantly', action: 'add' },
{ id: 'figma', popularity: '#5 popular', desc: 'Generate diagrams and better code from Figma context', action: 'add' },
  { id: 'hubspot', popularity: '#9 popular', desc: 'Chat with your CRM data to get personalized insights', action: 'add' },
  { id: 'notion', popularity: '#6 popular', desc: 'Connect your Notion workspace to search, update, and power workflows across tools', action: 'add' },
  { id: 'miro', popularity: '', desc: 'Access and create new content on Miro boards', action: 'add' },
  { id: 'linear', popularity: '', desc: 'Manage issues, projects & team workflows in Linear', action: 'add' },
  { id: 'slack', popularity: '#8 popular', desc: 'Send messages, create canvases, and fetch Slack data', action: 'add' },
  { id: 'asana', popularity: '', desc: 'Connect to Asana to coordinate tasks, projects, and goals', action: 'add' },
];

const PLUGIN_DIRECTORY_CARDS = [
  { name: 'Box', vendor: 'Box', desc: 'Work with your Box content directly from Anton Code - search files, organize folders, collaborate with your team.' },
  { name: 'Pdf viewer', vendor: 'Anton', desc: 'View, annotate, and sign PDFs in a live interactive viewer. Mark up contracts, fill forms, and review documents visually.' },
  { name: 'Adobe for creativity', vendor: 'Adobe', desc: 'Bring together Creative Cloud tools for images, vectors, design, and video in one workflow.' },
  { name: 'Figma', vendor: 'Figma', desc: 'Access design files, extract component information, read design tokens, and carry product context into Anton.' },
  { name: 'Product tracking skills', vendor: 'Accoil', desc: 'Make SaaS products data-ready for analytics work, from codebase scan to tracking plan.' },
  { name: 'Searchfit seo', vendor: 'SearchFit.ai', desc: 'Audit websites, plan content strategy, optimize pages, and generate schema with an SEO toolkit.' },
  { name: 'Atlan', vendor: 'Atlan', desc: 'Search, explore, govern, and manage your data assets through natural language workflows.' },
  { name: 'Brightdata plugin', vendor: 'Bright Data', desc: 'Web scraping, search, and structured data extraction powered by Bright Data.' },
  { name: 'Nimble', vendor: 'Nimble', desc: 'Search, extract, map, and crawl the web with structured-data agents.' },
  { name: 'Cloudinary', vendor: 'Cloudinary', desc: 'Manage assets, apply transformations, optimize media, and work with Cloudinary from Anton.' },
];

function ConnectorLogo({ id, large = false }) {
  const meta = CONNECTOR_LIBRARY[id] || { style: 'generic', name: id };
  const className = `customize-logo ${large ? 'large' : ''} ${meta.style}`;

  if (id === 'asana') {
    return (
      <span className={className} aria-hidden="true">
        <span className={`customize-asana-mark ${large ? 'large' : ''}`}>
          <span />
          <span />
          <span />
        </span>
      </span>
    );
  }

  if (id === 'google_drive') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M7.7 3 2.2 12.5 5 17h6l-3.3-5.7L13.2 3H7.7Z" fill="#FFC107" />
          <path d="M16.3 3h-3.1l5.5 9.5L22 12.5 16.3 3Z" fill="#1E88E5" />
          <path d="M5 17l3 5h11l-3-5H5Z" fill="#4CAF50" />
        </svg>
      </span>
    );
  }

  if (id === 'gmail') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M2 6.5C2 5.67 2.67 5 3.5 5h17c.83 0 1.5.67 1.5 1.5V18a1 1 0 0 1-1 1h-2V8.5l-8 5.5-8-5.5V19H3a1 1 0 0 1-1-1V6.5Z" fill="#EA4335" />
          <path d="M2 6.5 12 14l10-7.5V8L12 15.5 2 8V6.5Z" fill="#C5221F" />
        </svg>
      </span>
    );
  }

  if (id === 'google_calendar') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4" width="18" height="17" rx="2" fill="#fff" stroke="#1a73e8" strokeWidth="1.5" />
          <text x="12" y="17" textAnchor="middle" fontFamily="Arial" fontSize="9" fontWeight="700" fill="#1a73e8">31</text>
        </svg>
      </span>
    );
  }

  if (id === 'github') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
        </svg>
      </span>
    );
  }

  if (id === 'figma') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M8 2h4v6H8a3 3 0 0 1 0-6Z" fill="#F24E1E" />
          <path d="M12 2h4a3 3 0 0 1 0 6h-4V2Z" fill="#FF7262" />
          <path d="M12 8h4a3 3 0 0 1 0 6h-4V8Z" fill="#A259FF" />
          <path d="M8 8h4v6H8a3 3 0 0 1 0-6Z" fill="#1ABCFE" />
          <path d="M8 14h4v3a3 3 0 1 1-3-3H8Z" fill="#0ACF83" />
        </svg>
      </span>
    );
  }

  if (id === 'hubspot') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M18 9.5V6a2 2 0 1 0-2 2v1.5a5 5 0 1 0 2 0Z" fill="#ff7a59" />
          <circle cx="16" cy="14.5" r="3" fill="#ff7a59" stroke="#fff" strokeWidth="1" />
        </svg>
      </span>
    );
  }

  if (id === 'linear') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient id="customize-linear-gradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#5E6AD2" />
              <stop offset="1" stopColor="#26B0E8" />
            </linearGradient>
          </defs>
          <circle cx="12" cy="12" r="10" fill="url(#customize-linear-gradient)" />
          <path d="M5 13c0 3.9 3.1 7 7 7l-7-7ZM5 9.8 14.2 19c.7-.1 1.3-.3 1.9-.5L5.5 7.9c-.2.6-.4 1.2-.5 1.9ZM6.6 6 18 17.4c.4-.4.8-.8 1.2-1.2L7.8 4.8C7.4 5.2 7 5.6 6.6 6ZM10 5l9 9c.5-1 .8-2 .9-3.1L13.1 4.1c-1.1.1-2.1.4-3.1.9Z" fill="#fff" />
        </svg>
      </span>
    );
  }

  if (id === 'slack') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="3" y="10" width="6" height="3" rx="1.5" fill="#36C5F0" />
          <rect x="11" y="3" width="3" height="6" rx="1.5" fill="#2EB67D" />
          <rect x="15" y="11" width="6" height="3" rx="1.5" fill="#ECB22E" />
          <rect x="10" y="15" width="3" height="6" rx="1.5" fill="#E01E5A" />
          <rect x="10" y="10" width="4" height="4" rx="1" fill="#444" />
        </svg>
      </span>
    );
  }

  if (id === 'miro') {
    return (
      <span className={className} aria-hidden="true">
        <span className="customize-logo-text">M</span>
      </span>
    );
  }

  if (id === 'notion') {
    return (
      <span className={className} aria-hidden="true">
        <span className="customize-logo-text">N</span>
      </span>
    );
  }

  if (id === 'posthog') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="#1d4aff">
          <path d="M2 18 14 6v12ZM2 10v8h8Z" />
        </svg>
      </span>
    );
  }

  if (id === 'supabase') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="#3ecf8e">
          <path d="M14 1 0 16h10v11l14-15H14Z" />
        </svg>
      </span>
    );
  }

  if (id === 'cloudflare') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="#f48120">
          <path d="M18 8c-.37 0-.73.08-1.04.23A4.94 4.94 0 0 0 12.73 5c-2.2 0-4.04 1.48-4.66 3.5-.4-.17-.86-.26-1.36-.26A4.71 4.71 0 0 0 2 13h20c0-2.76-1.79-5-4-5Z" />
        </svg>
      </span>
    );
  }

  if (id === 'anton_chrome') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M8 21h8M12 18v3" />
        </svg>
      </span>
    );
  }

  if (id === 'control_chrome') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" fill="#fff" />
          <circle cx="12" cy="12" r="4" fill="#4285f4" />
          <path d="M12 2a10 10 0 0 1 8.66 5H12a5 5 0 0 0-4.58 3.02L3.34 5A10 10 0 0 1 12 2Z" fill="#ea4335" />
          <path d="M22 12a10 10 0 0 1-13.25 9.46L13 14a5 5 0 0 0 4.42-2.68l3.25-4.32A9.96 9.96 0 0 1 22 12Z" fill="#fbbc05" />
          <path d="M2 12a10 10 0 0 0 6.75 9.46L13 14a5 5 0 0 1-4.58-3.02L4.34 5A9.98 9.98 0 0 0 2 12Z" fill="#34a853" />
        </svg>
      </span>
    );
  }

  if (id === 'filesystem') {
    return (
      <span className={className} aria-hidden="true">
        <span className="customize-logo-text">F</span>
      </span>
    );
  }

  if (id === 'zoominfo') {
    return (
      <span className={className} aria-hidden="true">
        <span className="customize-logo-text">Z</span>
      </span>
    );
  }

  return (
    <span className={className} aria-hidden="true">
      {Ico.sparkle(large ? 26 : 16)}
    </span>
  );
}

function PluginLogo() {
  return (
    <span className="customize-plugin-logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 2v6" />
        <path d="M15 2v6" />
        <path d="M7 8h10a2 2 0 0 1 2 2v3a7 7 0 0 1-14 0v-3a2 2 0 0 1 2-2Z" />
        <path d="M12 22v-4" />
      </svg>
    </span>
  );
}

function Subnav({ page, onPageChange, onOpenPlugins }) {
  return (
    <aside className="customize-subnav">
      <button
        className={`customize-subnav-item${page === PAGE_CONNECTORS ? ' active' : ''}`}
        onClick={() => onPageChange(PAGE_CONNECTORS)}
      >
        {Ico.slider(17)}
        <span>Connectors</span>
      </button>

      <div className="customize-subnav-section">
        <div className="customize-subnav-section-head">
          <span>Personal plugins</span>
          <button className="customize-add-btn" aria-label="Browse plugins" onClick={onOpenPlugins}>
            {Ico.plus(14)}
          </button>
        </div>

        <div className="customize-subnav-empty">
          <p>Give Anton role-level expertise with plugins</p>
          <button className="customize-browse-btn" onClick={onOpenPlugins}>Browse plugins</button>
        </div>
      </div>
    </aside>
  );
}

function HomePage({ onOpenDirectory }) {
  return (
    <div className="customize-home-main">
      <div className="customize-home-content">
        <div className="customize-home-mark" aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="8" y="20" width="48" height="32" rx="4" />
            <path d="M24 20v-4a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v4" />
            <path d="M8 32h48" />
            <rect x="28" y="30" width="8" height="5" rx="1" />
          </svg>
        </div>

        <h1 className="customize-serif">Customize Anton</h1>
        <p className="customize-home-subtitle">Connectors and plugins shape how Anton works with you.</p>

        <div className="customize-home-cards">
          <button className="customize-home-card active" onClick={() => onOpenDirectory(DIRECTORY_MODE_CONNECTORS)}>
            <span className="customize-home-card-icon">{Ico.slider(18)}</span>
            <span className="customize-home-card-copy">
              <strong>Connect your apps</strong>
              <span>Let Anton read and write to the tools you already use.</span>
            </span>
          </button>

          <button className="customize-home-card" onClick={() => onOpenDirectory(DIRECTORY_MODE_PLUGINS)}>
            <span className="customize-home-card-icon">{Ico.sparkle(18)}</span>
            <span className="customize-home-card-copy">
              <strong>Browse plugins</strong>
              <span>Add pre-built knowledge for your field.</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectorsPage({
  connectorLibrary,
  connectorGroups,
  selectedConnector,
  onSelectConnector,
  onPageChange,
  onOpenPlugins,
  onOpenDirectory,
  driveConnections,
  integration,
  onStartGoogleDriveAuth,
  busyAction,
  status,
  driveAuthPending,
}) {
  const driveSelected = selectedConnector?.id === 'google_drive';
  const googleOauth = integration?.oauth || {};
  const connectMessage = driveSelected
    ? (driveConnections.length
        ? 'Anton is ready to use Google Drive.'
        : 'You are not connected to Google Drive yet.')
    : `You are not connected to ${selectedConnector?.name} yet.`;
  const connectLabel = driveConnections.length ? 'Connect another Google Drive' : 'Connect Google Drive';
  const driveConnectionSummary = driveConnections
    .map((connection) => connection.label || connection.subtitle || connection.name)
    .filter(Boolean)
    .slice(0, 2)
    .join(', ');
  const driveHasMoreConnections = driveConnections.length > 2;
  const detailNotes = [];

  if (driveSelected) {
    if (status) {
      detailNotes.push(status);
    } else if (googleOauth.configError) {
      detailNotes.push(googleOauth.configError);
    } else if (driveConnectionSummary) {
      detailNotes.push(
        `Connected ${driveConnections.length === 1 ? 'account' : 'accounts'}: ${driveConnectionSummary}${driveHasMoreConnections ? ', and more.' : '.'}`,
      );
    }
  } else if (selectedConnector?.status !== 'included') {
    detailNotes.push(`Setup for ${selectedConnector?.name} is not wired into Anton CoWork yet.`);
  }

  return (
    // Two-pane mode — the workflow lives inside Connect Apps and Data,
    // so the left subnav (which switched between the old "home" tab
    // and connectors) is gone. The user picks an app on the left, the
    // right pane shows that app's credentials + connect button.
    <div className="customize-two-pane">
      <section className="customize-middle-pane">
        <div className="customize-pane-header">
          <div className="customize-pane-title">Connectors</div>
          <div className="customize-pane-actions">
            <button className="icon-btn" type="button" aria-label="Search connectors" onClick={onOpenDirectory}>
              {Ico.search(15)}
            </button>
            <button className="icon-btn" type="button" aria-label="Add connector" onClick={onOpenDirectory}>
              {Ico.plus(15)}
            </button>
          </div>
        </div>

        <div className="customize-middle-scroll scroll-clean">
          {connectorGroups.map((group) => (
            <div key={group.label} className="customize-connector-group">
              <div className="customize-group-head">
                <span>{Ico.chevDown(12)}</span>
                <span>{group.label}</span>
                {group.label === 'Desktop' && (
                  <button className="icon-btn" type="button" aria-label="Connector settings">
                    {Ico.settings(14)}
                  </button>
                )}
              </div>

              {group.ids.map((id) => {
                const connector = connectorLibrary[id];
                const selected = selectedConnector?.id === id;
                return (
                  <button
                    key={id}
                    className={`customize-connector-row${selected ? ' selected' : ''}`}
                    onClick={() => onSelectConnector(connector)}
                  >
                    <ConnectorLogo id={id} />
                    <span className="customize-connector-name">
                      <span>
                        {connector.name}
                        {connector.interactive && <span className="customize-inline-tag">Interactive</span>}
                      </span>
                    </span>
                    {connector.chip && <span className="customize-chip">{connector.chip}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="customize-detail-pane">
        <div className="customize-detail-header">
          <button className="icon-btn" type="button" aria-label="More options">
            {Ico.more(16)}
          </button>
        </div>

        <div className="customize-empty-detail">
          <ConnectorLogo id={selectedConnector?.id || 'asana'} large />
          <div className="customize-empty-title">
            {selectedConnector?.status === 'included'
              ? `${selectedConnector.name} is already available in Anton Desktop.`
              : connectMessage}
          </div>
          <button
            className="customize-primary-btn"
            type="button"
            aria-label={
              selectedConnector?.status === 'included'
                ? `${selectedConnector.name} available`
                : driveSelected
                ? 'Connect Google Drive'
                : `Connect ${selectedConnector?.name || 'connector'}`
            }
            onClick={() => driveSelected && onStartGoogleDriveAuth()}
            disabled={!driveSelected && selectedConnector?.status !== 'included'}
          >
            {selectedConnector?.status === 'included'
              ? 'Available'
              : driveSelected
              ? (busyAction === 'connect'
                  ? 'Opening Google sign-in...'
                  : driveAuthPending
                  ? 'Waiting for Google sign-in...'
                  : connectLabel)
              : selectedConnector?.action || 'Connect'}
          </button>
          {detailNotes.map((note, index) => (
            <div key={`${selectedConnector?.id || 'connector'}-note-${index}`} className="customize-empty-note">
              {note}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DirectoryModal({ mode, onChangeMode, onClose, onChooseConnector }) {
  const [query, setQuery] = useState('');
  const connectorCards = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return DIRECTORY_CONNECTOR_CARDS.filter((card) => {
      const connector = CONNECTOR_LIBRARY[card.id];
      const haystack = `${connector?.name || ''} ${card.desc}`.toLowerCase();
      return !lower || haystack.includes(lower);
    });
  }, [query]);

  const pluginCards = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return PLUGIN_DIRECTORY_CARDS.filter((card) => {
      const haystack = `${card.name} ${card.vendor} ${card.desc}`.toLowerCase();
      return !lower || haystack.includes(lower);
    });
  }, [query]);

  return (
    <div className="customize-modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="customize-modal" role="dialog" aria-modal="true" aria-label="Customize directory">
        <div className="customize-modal-header">
          <h2 className="customize-serif">Directory</h2>
          <button className="icon-btn" type="button" aria-label="Close directory" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <nav className="customize-modal-side">
          <button
            className={`customize-modal-side-item${mode === DIRECTORY_MODE_CONNECTORS ? ' active' : ''}`}
            onClick={() => { setQuery(''); onChangeMode(DIRECTORY_MODE_CONNECTORS); }}
          >
            {Ico.slider(17)}
            <span>Connectors</span>
          </button>
          <button
            className={`customize-modal-side-item${mode === DIRECTORY_MODE_PLUGINS ? ' active' : ''}`}
            onClick={() => { setQuery(''); onChangeMode(DIRECTORY_MODE_PLUGINS); }}
          >
            {Ico.sparkle(17)}
            <span>Plugins</span>
          </button>
        </nav>

        <section className="customize-modal-content scroll-clean">
          <label className="customize-search-input">
            {Ico.search(16)}
            <input
              type="text"
              placeholder={mode === DIRECTORY_MODE_PLUGINS ? 'Search plugins...' : 'Search connectors...'}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div className="customize-modal-toolbar">
            {mode === DIRECTORY_MODE_PLUGINS ? (
              <div className="customize-tabset">
                <button className="customize-tab">Your organization</button>
                <button className="customize-tab active">Anton &amp; Partners</button>
              </div>
            ) : (
              <button className="customize-chip-filter">Anton &amp; Partners</button>
            )}
            <div className="customize-select-row">
              <button className="customize-select">Filter by {Ico.chevDown(12)}</button>
              <button className="customize-select">Sort by {Ico.chevDown(12)}</button>
            </div>
          </div>

          {mode === DIRECTORY_MODE_CONNECTORS ? (
            <>
              <p className="customize-section-copy">Available to your team</p>
              <div className="customize-directory-grid">
                {connectorCards.map((card) => {
                  const connector = CONNECTOR_LIBRARY[card.id];
                  const settingsAction = card.action === 'settings';
                  return (
                    <article
                      key={card.id}
                      className="customize-directory-card"
                      onClick={() => onChooseConnector(card.id)}
                    >
                      <div className="customize-directory-card-top">
                        <ConnectorLogo id={card.id} />
                        <div className="customize-directory-card-copy">
                          <div className="customize-directory-card-name">
                            {connector?.name}
                            {connector?.interactive && <span className="customize-inline-tag">Interactive</span>}
                          </div>
                          {card.popularity ? <div className="customize-directory-card-meta">{card.popularity}</div> : null}
                        </div>
                        <button className="icon-btn" type="button" aria-label={settingsAction ? 'Open connector settings' : 'Add connector'}>
                          {settingsAction ? Ico.settings(14) : Ico.plus(14)}
                        </button>
                      </div>
                      <p>{card.desc}</p>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="customize-directory-grid">
              {pluginCards.map((plugin) => (
                <article key={plugin.name} className="customize-directory-card">
                  <div className="customize-directory-card-top">
                    <PluginLogo />
                    <div className="customize-directory-card-copy">
                      <div className="customize-directory-card-name">{plugin.name}</div>
                      <div className="customize-directory-card-meta">{plugin.vendor}</div>
                    </div>
                    <button className="icon-btn" type="button" aria-label="Add plugin">
                      {Ico.plus(14)}
                    </button>
                  </div>
                  <p>{plugin.desc}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function ConnectWorkflowView({ onClose }) {
  // Always start on the connectors view — the old "home" overview
  // tab isn't part of this workflow anymore (the Connect Apps and
  // Data page already serves that role with the connection cards).
  const [page, setPage] = useState(PAGE_CONNECTORS);
  const [directoryMode, setDirectoryMode] = useState('');
  const [catalog, setCatalog] = useState(null);
  const [selectedConnectorId, setSelectedConnectorId] = useState('google_drive');
  const [driveStatus, setDriveStatus] = useState('');
  const [driveAuthPending, setDriveAuthPending] = useState(false);
  const [driveAuthStartedAt, setDriveAuthStartedAt] = useState('');
  const [busyAction, setBusyAction] = useState('');

  const refresh = async () => {
    const nextCatalog = await fetchIntegrations();
    setCatalog(nextCatalog);
    return { nextCatalog };
  };

  useEffect(() => {
    refresh().catch((error) => {
      setDriveStatus(error.message || 'Could not load Customize.');
    });
  }, []);

  const googleDriveIntegration = catalog?.items?.find((item) => item.id === 'google_drive') || null;
  const driveConnections = googleDriveIntegration?.connections || [];
  const googleDriveConnected = (googleDriveIntegration?.status === 'connected') || driveConnections.length > 0;

  const connectorLibrary = useMemo(() => ({
    ...CONNECTOR_LIBRARY,
    google_drive: {
      ...CONNECTOR_LIBRARY.google_drive,
      action: googleDriveConnected ? 'Manage' : 'Connect',
      chip: googleDriveConnected ? 'Connected' : undefined,
      status: googleDriveConnected ? 'connected' : 'planned',
    },
    github: {
      ...CONNECTOR_LIBRARY.github,
      chip: undefined,
      status: 'planned',
    },
    miro: {
      ...CONNECTOR_LIBRARY.miro,
      chip: undefined,
      status: 'planned',
    },
  }), [googleDriveConnected]);

  const connectorGroups = useMemo(() => {
    const connectedExternalIds = EXTERNAL_CONNECTOR_IDS.filter((id) => connectorLibrary[id]?.status === 'connected');
    const notConnectedIds = EXTERNAL_CONNECTOR_IDS.filter((id) => connectorLibrary[id]?.status !== 'connected');
    const groups = [];
    if (connectedExternalIds.length) {
      groups.push({ label: 'Connected', ids: connectedExternalIds });
    }
    groups.push({ label: 'Desktop', ids: DESKTOP_CONNECTOR_IDS });
    groups.push({ label: 'Not connected', ids: notConnectedIds });
    return groups;
  }, [connectorLibrary]);

  const selectedConnector = connectorLibrary[selectedConnectorId] || connectorLibrary.google_drive;

  const openDirectory = (mode) => {
    setDirectoryMode(mode);
  };

  const closeDirectory = () => {
    setDirectoryMode('');
  };

  const handleBack = () => {
    if (directoryMode) {
      closeDirectory();
      return;
    }
    // We never visit PAGE_HOME anymore — back from the connectors
    // pane returns to the parent Connect Apps and Data listing.
    onClose?.();
  };

  const handleSelectConnector = (connectorOrId) => {
    const connector = typeof connectorOrId === 'string' ? connectorLibrary[connectorOrId] : connectorOrId;
    if (!connector) return;
    setSelectedConnectorId(connector.id);
    setPage(PAGE_CONNECTORS);
    closeDirectory();
    setDriveStatus('');
  };

  const launchGoogleDriveAuth = async () => {
    try {
      setBusyAction('connect');
      setDriveStatus('');
      const result = await startGoogleDriveAuth();
      setDriveAuthStartedAt(result.startedAt || new Date().toISOString());
      setDriveAuthPending(true);
      setDriveStatus('Google sign-in opened in your browser. Finish there, then return here.');
      window.open(result.authUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setDriveAuthPending(false);
      setDriveStatus(error.message || 'Could not start Google Drive sign-in.');
    } finally {
      setBusyAction('');
    }
  };

  useEffect(() => {
    if (!driveAuthPending) return undefined;
    let cancelled = false;
    let timerId = null;
    const startedAt = driveAuthStartedAt;
    const deadline = Date.now() + 2 * 60 * 1000;

    const poll = async () => {
      try {
        const { nextCatalog } = await refresh();
        const nextIntegration = nextCatalog?.items?.find((item) => item.id === 'google_drive');
        const lastSuccessAt = nextIntegration?.oauth?.lastSuccessAt || '';
        const lastErrorAt = nextIntegration?.oauth?.lastErrorAt || '';
        if (lastSuccessAt && (!startedAt || lastSuccessAt >= startedAt)) {
          if (!cancelled) {
            setDriveAuthPending(false);
            setDriveStatus('Google Drive connected.');
          }
          return;
        }
        if (nextIntegration?.oauth?.lastError && lastErrorAt && (!startedAt || lastErrorAt >= startedAt)) {
          if (!cancelled) {
            setDriveAuthPending(false);
            setDriveStatus(nextIntegration.oauth.lastError);
          }
          return;
        }
      } catch {
        // Ignore transient refresh errors while the user is in the browser flow.
      }
      if (cancelled) return;
      if (Date.now() >= deadline) {
        setDriveAuthPending(false);
        setDriveStatus('Still waiting for Google Drive sign-in. Finish the browser step, then retry if needed.');
        return;
      }
      timerId = window.setTimeout(poll, 3000);
    };

    timerId = window.setTimeout(poll, 3000);
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [driveAuthPending, driveAuthStartedAt]);

  return (
    <div className="customize-view">
      <div className="customize-header">
        <button
          className="customize-back-btn"
          type="button"
          aria-label="Back to connections"
          title="Back to connections"
          onClick={handleBack}
        >
          {Ico.chevLeft(16)}
        </button>
        <div className="customize-header-title">Connect Apps and Data</div>
      </div>

      <div className="customize-body">
        {page === PAGE_CONNECTORS && (
          <ConnectorsPage
            connectorLibrary={connectorLibrary}
            connectorGroups={connectorGroups}
            selectedConnector={selectedConnector}
            onSelectConnector={handleSelectConnector}
            onPageChange={setPage}
            onOpenPlugins={() => openDirectory(DIRECTORY_MODE_PLUGINS)}
            onOpenDirectory={() => openDirectory(DIRECTORY_MODE_CONNECTORS)}
            driveConnections={driveConnections}
            integration={googleDriveIntegration}
            onStartGoogleDriveAuth={launchGoogleDriveAuth}
            busyAction={busyAction}
            status={driveStatus}
            driveAuthPending={driveAuthPending}
          />
        )}

      </div>

      {directoryMode && (
        <DirectoryModal
          mode={directoryMode}
          onChangeMode={setDirectoryMode}
          onClose={closeDirectory}
          onChooseConnector={(id) => handleSelectConnector(id)}
        />
      )}
    </div>
  );
}
