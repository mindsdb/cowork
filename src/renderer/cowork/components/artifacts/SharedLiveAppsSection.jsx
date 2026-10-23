/*
 * "Shared with you" on the Live Artifacts page: the same list as the chat
 * rail's card (rail/SharedLiveApps.jsx), so a person whom someone shared an
 * app with finds it where they look for artifacts, also before they have any
 * of their own. ArtifactsView renders it only on a deployment that runs live
 * apps, with the General project to put the copy in: the page spans every
 * project, and cowork-server's `POST /artifacts/live-app-duplicate` needs one.
 * Draws nothing while nobody has shared anything.
 */

import Ico from '../Icons';
import { Button } from '../ui';
import { ListGroup, ListItem, ListNotice } from '../collection';
import { useSharedLiveApps } from '../rail/SharedLiveApps';
import { COPY_GOES_TO_GENERAL, SHARED_WITH_YOU_LABEL, sharedByLine } from '../../lib/liveAppSharing';

export function SharedLiveAppsSection({ projectId, onDuplicated, className }) {
  const { apps, loadError, choose, disclaimer } = useSharedLiveApps({
    projectId,
    onDuplicated,
    destination: COPY_GOES_TO_GENERAL,
  });

  const showList = apps.length > 0 || Boolean(loadError);
  return (
    <>
      {showList && (
        <ListGroup className={className} aria-label={SHARED_WITH_YOU_LABEL} title={<h2>{SHARED_WITH_YOU_LABEL}</h2>}>
          {loadError && <ListNotice className="text-sm text-danger">{loadError}</ListNotice>}
          {apps.map((app) => (
            <ListItem
              key={app.shareId}
              leading={Ico.globe(16)}
              title={app.name}
              description={sharedByLine(app)}
              actions={(
                <Button size="sm" variant="tinted" aria-label={`Duplicate ${app.name}`} onClick={() => choose(app)}>
                  Duplicate
                </Button>
              )}
            />
          ))}
        </ListGroup>
      )}
      {disclaimer}
    </>
  );
}
