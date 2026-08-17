import Ico from '../Icons';

// Sample prompts for a selected task mode (ENG-1594). Two presentations,
// mirroring Manus: 'cards' (a labelled grid — slides, visualization) and
// 'rows' (a plain list). Picking a sample fills the composer with the
// sample's FULL prompt (the visible label is just the list text) via
// onPick; it never sends — the user edits first.
export default function TaskModeSamples({ mode, onPick }) {
  const isCards = mode.samplesVariant === 'cards';
  return (
    <div className="task-mode-samples">
      {isCards && (
        <div
          className="task-mode-samples__heading"
          style={{ opacity: 0, animation: 'fadein-up 260ms cubic-bezier(0.23, 1, 0.32, 1) 40ms both' }}
        >
          Sample prompts
        </div>
      )}
      <div className={isCards ? 'task-mode-samples__grid' : 'task-mode-samples__list'}>
        {mode.samples.map((sample, i) => (
          <button
            key={sample.label}
            type="button"
            className={isCards ? 'task-sample-card' : 'task-sample-row'}
            style={{
              opacity: 0,
              animation: `fadein-up 260ms cubic-bezier(0.23, 1, 0.32, 1) ${80 + i * 40}ms both`,
            }}
            onClick={() => onPick(sample.prompt)}
          >
            <span className="task-sample__text">{sample.label}</span>
            <span className="task-sample__arrow" aria-hidden>{Ico.arrowUpLeft(14)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
