// A text block on the page: paragraph, heading, list item, to-do, quote or
// callout, each an EditableText (`edit` carries its props) dressed for its kind.
import { Check } from 'lucide-react';
import { Icon } from '../ui/Icon';
import EditableText from './EditableText';
import { TONE_ICONS } from './blockIcons';

function CalloutIcon({ tone }) {
  return <span className="doc-callout__icon"><Icon of={TONE_ICONS[tone] || TONE_ICONS.info} size={16} /></span>;
}

/** `number` is a numbered item's place in its list; `lonely`, whether it is the page's only block. */
export default function TextBlock({ block: b, edit, editable, number, lonely, onOps }) {
  switch (b.type) {
    case 'heading':
      return <EditableText {...edit} className={`doc-h doc-h--${b.level}`} placeholder={`Heading ${b.level}`} ariaLabel={`Heading ${b.level}`} />;
    case 'bullet':
    case 'numbered':
    case 'task': {
      const mark = b.type === 'task' ? (
        <button type="button" role="checkbox" className="doc-check" aria-checked={!!b.done} aria-label={b.done ? 'Mark not done' : 'Mark done'}
          disabled={!editable} onClick={() => onOps([{ op: 'update', id: b.id, set: { done: !b.done } }])}>
          {b.done && <Icon of={Check} size={12} />}
        </button>
      ) : (
        <span className="doc-li__mark" aria-hidden="true">
          {b.type === 'numbered' ? `${number || 1}.` : <span className={`doc-li__bullet doc-li__bullet--${((b.indent || 0) % 3) + 1}`} />}
        </span>
      );
      return (
        <div className={`doc-li ${b.done ? 'doc-li--done' : ''}`} style={{ paddingLeft: (b.indent || 0) * 24 }}>
          {mark}
          <EditableText {...edit} placeholder="List item" ariaLabel={b.type === 'task' ? 'To-do' : 'List item'} />
        </div>
      );
    }
    case 'quote':
      return <div className="doc-quote"><EditableText {...edit} placeholder="Quote" /></div>;
    case 'callout':
      return (
        <div className={`doc-callout doc-callout--${b.tone || 'info'}`}>
          <CalloutIcon tone={b.tone} />
          <div className="doc-callout__body">
            {(b.title || '') && (
              <EditableText value={b.title} plain singleLine editable={editable} className="doc-callout__title"
                onCommit={(title) => onOps([{ op: 'update', id: b.id, set: { title } }])} />
            )}
            <EditableText {...edit} placeholder="Callout" />
          </div>
        </div>
      );
    default:
      return (
        <EditableText
          {...edit}
          className={`doc-p ${lonely ? 'doc-p--lonely' : ''}`}
          placeholder={lonely ? 'Start writing, or type / for blocks' : 'Type / for blocks'}
          ariaLabel="Paragraph"
        />
      );
  }
}
