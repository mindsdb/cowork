import { useEffect, useRef, useState } from 'react';
import Button from '../components/ui/Button';
import { codingApi, type CodingSession } from './api';
import { newAttention, taskAttention } from './taskAttention';
import { isAppVisible } from './useAppVisible';
import './task-control.css';

export function TaskAttentionBar({ sessions, selectedId, active, scopeKey, onSelect }: {
  sessions: CodingSession[];
  selectedId: string | null;
  active: boolean;
  scopeKey: string;
  onSelect: (id: string) => void;
}) {
  const [notifications, setNotifications] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const previous = useRef(new Map<string, CodingSession>());
  const notices = useRef(new Map<string, Notification>());
  const generation = useRef(0);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const attention = sessions.filter(session => session.id !== selectedId && taskAttention(session));

  useEffect(() => {
    generation.current += 1;
    previous.current.clear();
    setNotifications(false);
    setPermissionError('');
    return () => { generation.current += 1; notices.current.forEach(notice => notice.close()); notices.current.clear(); };
  }, [scopeKey]);

  useEffect(() => {
    if (!notifications) return;
    let alive = true;
    let checking = false;
    const check = async () => {
      // Visible tasks already have inline decisions and an attention list.
      if (checking || (active && isAppVisible())) return;
      checking = true;
      try {
        const page = await codingApi.sessions();
        if (!alive) return;
        for (const session of page.items) {
          const message = newAttention(previous.current.get(session.id), session);
          if (!message) continue;
          notices.current.get(session.id)?.close();
          const notice = new Notification('MindsHub Code', { body: message, tag: `code-task-${session.id}` });
          notices.current.set(session.id, notice);
          notice.onclick = () => { if (alive) { window.focus(); selectRef.current(session.id); } notice.close(); };
        }
        previous.current = new Map(page.items.map(session => [session.id, session]));
      } catch { /* Transient polling failures must not become alert storms. */ }
      finally { checking = false; }
    };
    const timer = window.setInterval(() => void check(), 5000);
    return () => { alive = false; window.clearInterval(timer); notices.current.forEach(notice => notice.close()); notices.current.clear(); };
  }, [active, notifications, scopeKey]);

  useEffect(() => {
    if (active && isAppVisible()) previous.current = new Map(sessions.map(session => [session.id, session]));
  }, [sessions, active]);

  const toggle = async () => {
    const requestedGeneration = generation.current;
    setPermissionError('');
    if (notifications) { setNotifications(false); return; }
    if (typeof Notification === 'undefined') { setPermissionError('Desktop notifications are unavailable in this window.'); return; }
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (requestedGeneration !== generation.current) return;
      if (permission !== 'granted') { setPermissionError('Allow MindsHub notifications in your system settings to receive alerts.'); return; }
      previous.current = new Map(sessions.map(session => [session.id, session]));
      setNotifications(true);
    } catch { if (requestedGeneration === generation.current) setPermissionError('Notifications could not be enabled. You can still find decisions under Needs attention.'); }
  };
  return <div className="code-attention-bar" aria-label="Task attention">
    <div>{attention.length > 0 && <Button size="sm" variant="subtle" onClick={() => onSelect(attention[0].id)}>{attention.length} {attention.length === 1 ? 'task needs' : 'tasks need'} you →</Button>}</div>
    <Button size="sm" variant="subtle" aria-pressed={notifications} onClick={() => void toggle()}>{notifications ? 'Notifications on' : 'Notify when away'}</Button>
    {permissionError && <p role="status">{permissionError}</p>}
  </div>;
}
