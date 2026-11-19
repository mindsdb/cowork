import { useRef, useState } from 'react';
import Ico from '../Icons';
import Button from '../ui/Button';
import { Tabs, TabList, Tab, TabPanel } from '../ui/Tabs';
import { useTranslation } from '../../../lib/i18n';
import { OWN_WORK_JOB_GROUPS } from './taskModes';

// Under the composer in the own-work mode: the ways to hand Cowork something,
// then optional jobs grouped by kind of work. Nothing here sends; a job only
// starts the draft, and the composer sends once there is something to work on.
export default function OwnWorkPanel({ onPickJob, onAttachFiles, waitingForMaterial = false }) {
  const { t } = useTranslation('chat');
  const fileRef = useRef(null);
  const [groupId, setGroupId] = useState(OWN_WORK_JOB_GROUPS[0].id);
  const group = OWN_WORK_JOB_GROUPS.find((g) => g.id === groupId) ?? OWN_WORK_JOB_GROUPS[0];

  return (
    <div className="mt-4 w-full max-w-[var(--composer-max-width,640px)] [animation:fadein-up_var(--dur-layout)_var(--ease-out)_both]">
      {waitingForMaterial && (
        <p role="status" className="m-0 mb-3 text-sm text-[var(--frost-700)]">
          {t('ownWork.needsMaterial')}
        </p>
      )}
      <div className="flex flex-col items-center gap-2" role="group" aria-label={t('ownWork.waysLabel')}>
        <Button variant="primary" size="lg" onClick={() => fileRef.current?.click()}>
          <span aria-hidden className="inline-flex">{Ico.attach(16)}</span>
          {t('ownWork.attach')}
        </Button>
        <span className="text-[13px] text-[var(--frost-600)]">
          {t('ownWork.orPaste')}
        </span>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onAttachFiles?.(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <div className="mt-8 mx-[2px] mb-2 text-[13px] font-medium text-[var(--frost-600)]">
        {t('ownWork.jobsHeading')}
      </div>
      <Tabs value={group.id} onValueChange={(v) => setGroupId(v)}>
        <TabList className="mb-1 flex-wrap gap-[6px] border-b-0" aria-label={t('ownWork.kindsLabel')}>
          {OWN_WORK_JOB_GROUPS.map((g) => (
            <Tab
              key={g.id}
              value={g.id}
              className="mb-0 rounded-full border border-solid border-line-2 px-3 py-[5px] [font-family:inherit] text-[12.5px] font-medium text-[var(--frost-700)] hover:text-[var(--text-strong)] aria-[selected=true]:border-[var(--text-strong)] aria-[selected=true]:bg-[var(--text-strong)] aria-[selected=true]:text-[var(--surface-0)]"
            >
              {t(`ownWork.groups.${g.id}`)}
            </Tab>
          ))}
        </TabList>
        {OWN_WORK_JOB_GROUPS.map((g) => (
          <TabPanel key={g.id} value={g.id} className="flex flex-col pt-0">
            {g.jobs.map((j, i) => (
              <button
                key={j.label}
                type="button"
                className="group flex w-full cursor-pointer items-center gap-3 border-0 border-b border-solid border-line bg-transparent px-1 py-[13px] text-left [font-family:inherit] text-[13.5px] text-[var(--frost-700)] last:border-b-0 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text-strong)]"
                onClick={() => onPickJob?.(j.prompt)}
              >
                <span className="min-w-0 flex-1">{t(`ownWork.jobs.${g.id}.${i}`)}</span>
                <span aria-hidden className="inline-flex shrink-0 text-[var(--frost-500)] opacity-70">{Ico.arrowUpLeft(14)}</span>
              </button>
            ))}
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}
