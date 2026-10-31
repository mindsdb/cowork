// `<AudiencePanel>`: "who can open / use this", one component for both
// audiences: the artifact Share panel ("Who can access your app") and a
// skill's audience (the Share dropdown and the Add/Edit skill side column).
// Same cards, same look, same inline expansion; the caller decides which
// options appear.
//
//   <AudiencePanel
//     ariaLabel="Who can use this skill"
//     value={mode} onValueChange={setMode}
//     options={[onlyMeOption(SHARED_KIND.SKILL), …]}
//     specificValue={AUDIENCE_CHOICE.SPECIFIC}
//     recipients={{ value, onChange, orgName, teamsState, allowExternal }}
//   >
//     {slot under the cards: a password box, the always-on switch}
//   </AudiencePanel>
//
// An option may be `disabled` with a `disabledHint`: a disabled control fires
// no hover of its own, so the hint hangs off a wrapper (`disabledTestId`).
// The option whose value is `specificValue` unfolds a `<RecipientField>`
// (given `recipients`) right under its own card when picked.
// `onlyMeOption`, `everyoneOption` and `specificOption` are the cards both
// audiences offer, with the copy from lib/orgSharing.

import { RadioGroup } from '@base-ui/react/radio-group';
import Ico from './Icons';
import { Tooltip } from './ui';
import { AudienceOption } from './AudienceOption';
import RecipientField from './RecipientField';
import {
  AUDIENCE_CHOICE,
  EVERYONE_AT_DESC,
  ONLY_ME_DESC,
  ONLY_ME_TITLE,
  SPECIFIC_DESC,
  SPECIFIC_TITLE,
  everyoneAtLabel,
} from '../lib/orgSharing';

/**
 * The "Only me" option for a skill or an artifact (`kind`, a SHARED_KIND).
 * @param {'skill' | 'artifact'} kind
 */
export function onlyMeOption(kind) {
  return { value: AUDIENCE_CHOICE.PRIVATE, icon: Ico.lock(16), title: ONLY_ME_TITLE, desc: ONLY_ME_DESC[kind] };
}

/**
 * The "Everyone at ‹org›" option. With a `lockReason` (orgShareLockReason:
 * the caller lacks the permission, or MindsHub couldn't be asked) it is
 * grayed, with the reason on hover. One already shared with everyone shows
 * it picked all the same.
 * @param {{ orgName: string | null, lockReason: string | null }} args
 */
export function everyoneOption({ orgName, lockReason }) {
  return {
    value: AUDIENCE_CHOICE.ORG,
    icon: Ico.building(16),
    title: everyoneAtLabel(orgName),
    desc: EVERYONE_AT_DESC,
    disabled: !!lockReason,
    disabledHint: lockReason,
    disabledTestId: 'org-option-locked',
  };
}

/**
 * The "Specific teams and people" option for a skill or an artifact.
 * @param {'skill' | 'artifact'} kind
 */
export function specificOption(kind) {
  return { value: AUDIENCE_CHOICE.SPECIFIC, icon: Ico.people(16), title: SPECIFIC_TITLE, desc: SPECIFIC_DESC[kind] };
}

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
