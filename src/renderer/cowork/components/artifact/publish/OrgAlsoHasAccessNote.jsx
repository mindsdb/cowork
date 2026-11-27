import Ico from '../../Icons';
import { Tooltip } from '../../ui';
import { useTranslation } from '../../../../lib/i18n';

/* Under "Specific people" when the organization keeps its access although
   this panel can't offer "Everyone at ‹org›" (a personal organization, a
   pasted key, signed out): saving the list keeps that access, so the panel
   says so rather than letting an emptied list look private. */
export default function OrgAlsoHasAccessNote() {
  const { t } = useTranslation('artifacts');
  return (
    <Tooltip content={t('publish.access.orgAlsoHasAccessHint')}>
      <span
        tabIndex={0}
        data-testid="org-also-has-access"
        className="mt-1.5 flex items-center gap-1.5 font-body text-[11.5px] text-ink-3"
      >
        {Ico.building(12)}
        {t('publish.access.orgAlsoHasAccess')}
      </span>
    </Tooltip>
  );
}
