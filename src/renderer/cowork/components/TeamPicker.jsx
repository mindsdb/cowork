// `<TeamPicker>` — the caller's MindsHub teams as a checklist, for sharing a
// skill or an artifact with teams (ENG-3787). `teamsState` is what
// `useHubTeams` returns; loading, unreachable and no-teams each say so.
// Only the caller's own teams are ever listed (and the server refuses any
// other), so the search box filters that list rather than the whole org.
// The org's default team ("All members") is never listed: "Everyone at
// ‹org›" is that choice. A default team id already in `teamIds` is kept.

import { useState } from 'react';
import { Checkbox, Input, Spinner } from './ui';
import { shareableTeams } from '../lib/orgSharing';

export function filterTeams(teams, query, teamIds = []) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return teams;
  // A picked team stays visible while searching, so it can be unticked.
  return teams.filter((team) => teamIds.includes(team.id)
    || (team.display_name || '').toLowerCase().includes(q));
}

export function TeamPicker({ teamsState, teamIds, onChange }) {
  const [query, setQuery] = useState('');
  if (teamsState.status !== 'ready') {
    return (
      <span className="inline-flex items-center gap-2 font-body text-xs text-ink-3">
        <Spinner /> Loading teams…
      </span>
    );
  }
  if (!teamsState.reachable) {
    return <span className="font-body text-xs text-ink-3">Couldn't load your teams. Try again later.</span>;
  }
  const teams = shareableTeams(teamsState.teams);
  if (teams.length === 0) {
    return <span className="font-body text-xs text-ink-3">You're not in any teams yet.</span>;
  }
  const shown = filterTeams(teams, query, teamIds);
  return (
    <div className="flex flex-col gap-2">
    <Input
      value={query}
      onChange={(v) => setQuery(v)}
      placeholder="Search your teams"
      aria-label="Search your teams"
    />
    <div role="group" aria-label="Teams" className="flex max-h-[160px] flex-col gap-[6px] overflow-y-auto">
      {shown.length === 0 && (
        <span className="font-body text-xs text-ink-3">None of your teams match.</span>
      )}
      {shown.map((team) => {
        const checked = teamIds.includes(team.id);
        return (
          <label key={team.id} className="flex min-w-0 items-center gap-2 cursor-pointer font-body text-[13px] text-ink [overflow-wrap:anywhere]">
            <Checkbox
              checked={checked}
              onCheckedChange={(next) => onChange(next
                ? [...teamIds, team.id]
                : teamIds.filter((id) => id !== team.id))}
            />
            {team.display_name || 'Unnamed team'}
          </label>
        );
      })}
    </div>
    </div>
  );
}

export default TeamPicker;
