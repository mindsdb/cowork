// The doc's Edit / Comment switch while its comments are open: the artifact
// viewer's Navigate / Comment pill (CommentsToolbar), with Edit in place of
// Navigate. Comment leaves the page read-only and turns a click on a block
// into a comment on it; Edit gives the page back to typing.
import Ico from '../Icons';
import { ModeSwitch } from '../artifact/ModeSwitch';
import { useTranslation } from '../../../lib/i18n';

export default function DocCommentModeSwitch({ commenting, onChange }) {
  const { t } = useTranslation('docs');
  const { t: tArtifacts } = useTranslation('artifacts');
  return (
    <ModeSwitch
      ariaLabel={tArtifacts('comments.toolbar.ariaLabel')}
      className="doc-comment-mode-switch"
      value={commenting ? 'comment' : 'edit'}
      onChange={(value) => onChange(value === 'comment')}
      options={[
        { value: 'edit', icon: Ico.textCursor(14), label: t('comments.edit'), hint: t('comments.editHint') },
        { value: 'comment', icon: Ico.chats(14), label: tArtifacts('comments.toolbar.commentLabel'), hint: t('comments.commentHint') },
      ]}
    />
  );
}
