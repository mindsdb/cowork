// `<AudiencePanel>` — "who can open / use this", one component for both
// audiences (ENG-3787): the artifact Share panel ("Who can access your app")
// and a skill's audience (the Share dropdown and the Add/Edit skill side
// column). Same cards, same look, same inline expansion; the caller decides
// which options appear.
//
//   <AudiencePanel
//     ariaLabel="Who can use this skill"
//     value={mode} onValueChange={setMode}
//     options={[{ value: 'private', icon, title, desc }, …]}
//     specificValue="specific"
//     recipients={{ value, onChange, orgName, teamsState, allowExternal }}
//   >
//     {slot under the cards: a password box, the always-on switch}
//   </AudiencePanel>
//
// An option may be `disabled` with a `disabledHint`: a disabled control fires
// no hover of its own, so the hint hangs off a wrapper (`disabledTestId`).
// The option whose value is `specificValue` unfolds a `<RecipientField>`
// (given `recipients`) right under its own card when picked.

import { RadioGroup } from '@base-ui/react/radio-group';
import { Tooltip } from './ui';
import { AudienceOption } from './AudienceOption';
import RecipientField from './RecipientField';

/**
 * @param {{
 *   ariaLabel: string,
 *   value: string,
 *   onValueChange: (value: string) => void,
 *   options: Array<{ value: string, icon: import('react').ReactNode, title: string, desc: string, disabled?: boolean, disabledHint?: string, disabledTestId?: string }>,
 *   specificValue?: string,
 *   recipients?: object | null,
 *   children?: import('react').ReactNode,
 * }} props
 */
export function AudiencePanel({
  ariaLabel,
  value,
  onValueChange,
  options,
  specificValue = null,
  recipients = null,
  children = null,
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <RadioGroup
        value={value}
        onValueChange={onValueChange}
        className="flex min-w-0 flex-col gap-2"
        aria-label={ariaLabel}
      >
        {options.map((option) => {
          const card = (
            <AudienceOption
              key={option.value}
              value={option.value}
              active={value === option.value}
              icon={option.icon}
              title={option.title}
              desc={option.desc}
              disabled={!!option.disabled}
              editor={option.value === specificValue && recipients ? <RecipientField {...recipients} /> : null}
              editorTestId="specific-recipients"
            />
          );
          if (!option.disabled || !option.disabledHint) return card;
          return (
            <Tooltip key={option.value} content={option.disabledHint}>
              <div data-testid={option.disabledTestId}>{card}</div>
            </Tooltip>
          );
        })}
      </RadioGroup>
      {children}
    </div>
  );
}

export default AudiencePanel;
