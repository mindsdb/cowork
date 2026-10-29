// `<TeamPicker>` — the caller's MindsHub teams as a checklist, for sharing a
// skill or an artifact with teams (ENG-3787). `teamsState` is what
// `useHubTeams` returns; loading, unreachable and no-teams each say so.

import { Checkbox, Spinner } from './ui';

export function TeamPicker({ teamsState, teamIds, onChange }) {
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
  if (teamsState.teams.length === 0) {
    return <span className="font-body text-xs text-ink-3">You're not in any teams yet.</span>;
  }
  return (
    <div role="group" aria-label="Teams" className="flex max-h-[160px] flex-col gap-[6px] overflow-y-auto">
      {teamsState.teams.map((team) => {
        const checked = teamIds.includes(team.id);
        return (
          <label key={team.id} className="flex items-center gap-2 cursor-pointer font-body text-[13px] text-ink">
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
  );
}

export default TeamPicker;
