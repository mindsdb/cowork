import { useEffect, useState } from 'react';
import { Button, Card, Spinner, Tooltip } from './ui';
import Ico from './Icons';
import { fetchRules, revokeRule } from '../api';

// Standing rules — the "Always" grants beside Lessons: one mental model of
// durable authority. Every grant shows its scope, evidence trail (hit count,
// last fired), and a one-click revoke that re-gates the very next action.
// A grant never exists without visible revocation.

function describe(actionKind) {
  const [tool, ...rest] = String(actionKind || '').split(':');
  const label = rest.join(':') || actionKind;
  const pretty = label.charAt(0).toUpperCase() + label.slice(1);
  return { pretty, tool };
}

function relTime(iso) {
  if (!iso) return 'never used';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins || 1}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function RulesShelf() {
  const [rules, setRules] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      setRules(await fetchRules());
    } catch (e) {
      setError(e?.message || 'Could not load rules');
      setRules([]);
    }
  };
  useEffect(() => { load(); }, []);

  const revoke = async (rule) => {
    if (busy) return;
    setBusy(rule.id);
    try {
      await revokeRule(rule.id);
      setRules((prev) => (prev || []).filter((r) => r.id !== rule.id));
    } catch (e) {
      setError(e?.message || 'Could not revoke');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card padding="snug" flat style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--accent)', display: 'inline-flex' }}>{Ico.key ? Ico.key(14) : Ico.lock(14)}</span>
        <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-strong)' }}>Standing rules</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--frost-600)', lineHeight: 1.45 }}>
        “Always” grants from your approvals — deterministic, scoped, revocable.
      </div>

      {error && <div style={{ fontSize: 11.5, color: 'var(--danger)' }}>{error}</div>}

      {rules === null ? (
        <div style={{ padding: '8px 0' }}><Spinner style={{ width: 14, height: 14 }} /></div>
      ) : rules.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--frost-600)', padding: '4px 0' }}>
          No standing rules — Anton asks each time.
        </div>
      ) : (
        rules.map((rule) => {
          const { pretty, tool } = describe(rule.actionKind);
          return (
            <div
              key={rule.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 'var(--r-md, 8px)',
                border: '1px solid var(--line)', background: 'var(--surface-2)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pretty} on {rule.origin}
                </div>
                <div style={{ fontSize: 11, color: 'var(--frost-600)', marginTop: 2 }}>
                  {tool} · {rule.hitCount}× used · {relTime(rule.lastFiredAt)}
                </div>
              </div>
              <Tooltip content="Revoke — Anton asks again next time" delay={250}>
                <span>
                  <Button size="sm" variant="subtle" disabled={busy === rule.id} onClick={() => revoke(rule)}>
                    {busy === rule.id ? <Spinner style={{ width: 12, height: 12 }} /> : 'Revoke'}
                  </Button>
                </span>
              </Tooltip>
            </div>
          );
        })
      )}
    </Card>
  );
}
