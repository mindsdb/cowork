// Comments' Navigate / Comment switch (ENG-4383), Live edit's twin: a pill
// floating at the bottom centre of the artifact. Navigate leaves the page
// working, with the pins on it; Comment turns a click on the page into a
// new comment there (⌥ picks the container). Comments are left with the
// Comments toggle or the inbox's close, so the pill has nothing else.

import Ico from '../../Icons';
import { ModeSwitch } from '../ModeSwitch';
import { useTranslation } from '../../../../lib/i18n';

export function CommentsToolbar({
  mode,           // comment-placement mode active in the iframe (layer echo)
  onChangeMode,   // (on: boolean) => void
}) {
  const { t } = useTranslation('artifacts');
  return (
    <ModeSwitch
      ariaLabel={t('comments.toolbar.ariaLabel')}
      className="artifact-comments-mode-switch"
      value={mode ? 'comment' : 'navigate'}
      onChange={(value) => onChangeMode(value === 'comment')}
      options={[
        { value: 'navigate', icon: Ico.pointer(14), label: t('comments.toolbar.navigate'), hint: t('comments.toolbar.navigateHint') },
        { value: 'comment', icon: Ico.chats(14), label: t('comments.toolbar.commentLabel'), hint: t('comments.toolbar.comment') },
      ]}
    />
  );
}

export default CommentsToolbar;
