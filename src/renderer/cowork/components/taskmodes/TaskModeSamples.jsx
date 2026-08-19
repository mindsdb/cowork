import Ico from '../Icons';

// Sample prompts for a selected task mode (ENG-1594). Two presentations,
// mirroring Manus: 'cards' (a labelled grid — slides, visualization) and
// 'rows' (a plain list). Picking a sample fills the composer with the
// sample's FULL prompt (the visible label is just the list text) via
// onPick; it never sends — the user edits first.
//
// Styling notes: Tailwind utilities (no globals.css entries). Hover rules
// are gated behind (hover:hover) and (pointer:fine) via arbitrary variants;
// the stagger delay rides a --stagger CSS var so motion-reduce can kill the
// entrance animation from a class. Card/row class strings stay whole
// literals in each ternary branch — Tailwind's scanner can't see through
// interpolation.
export default function TaskModeSamples({ mode, onPick }) {
  const isCards = mode.samplesVariant === 'cards';
  return (
    <div className="mt-[28px] w-full max-w-[var(--composer-max-width,640px)]">
      {isCards && (
        <div className="mx-[2px] mb-3 text-[13px] font-semibold text-[var(--text-strong)] opacity-0 [animation:fadein-up_260ms_cubic-bezier(0.23,1,0.32,1)_40ms_both] motion-reduce:animate-none motion-reduce:opacity-100">
          Sample prompts
        </div>
      )}
      <div className={isCards ? 'grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-[10px]' : 'flex flex-col'}>
        {mode.samples.map((sample, i) => (
          <button
            key={sample.label}
            type="button"
            style={{ '--stagger': `${80 + i * 40}ms` }}
            className={isCards
              ? 'group flex min-h-[104px] cursor-pointer flex-col items-stretch gap-[14px] rounded-xl border border-solid border-line-2 bg-transparent px-[14px] py-3 text-left [font-family:inherit] text-[13px] leading-[1.45] text-[var(--frost-700)] opacity-0 [animation:fadein-up_260ms_cubic-bezier(0.23,1,0.32,1)_var(--stagger)_both] motion-reduce:animate-none motion-reduce:opacity-100 [transition:background_140ms_ease,color_140ms_ease,border-color_140ms_ease] active:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text-strong)]'
              : 'group flex w-full cursor-pointer items-center gap-3 border-0 border-b border-solid border-line bg-transparent px-1 py-[13px] text-left [font-family:inherit] text-[13.5px] text-[var(--frost-700)] last:border-b-0 opacity-0 [animation:fadein-up_260ms_cubic-bezier(0.23,1,0.32,1)_var(--stagger)_both] motion-reduce:animate-none motion-reduce:opacity-100 [transition:background_140ms_ease,color_140ms_ease,border-color_140ms_ease] active:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text-strong)]'}
            onClick={() => onPick(sample.prompt)}
          >
            <span className="min-w-0 flex-1">{sample.label}</span>
            <span
              className={isCards
                ? 'mt-auto inline-flex shrink-0 self-end text-[var(--frost-500)] opacity-70 [transition:opacity_140ms_ease,color_140ms_ease] [@media(hover:hover)_and_(pointer:fine)]:group-hover:text-[var(--frost-700)] [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100'
                : 'inline-flex shrink-0 text-[var(--frost-500)] opacity-70 [transition:opacity_140ms_ease,color_140ms_ease] [@media(hover:hover)_and_(pointer:fine)]:group-hover:text-[var(--frost-700)] [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100'}
              aria-hidden
            >
              {Ico.arrowUpLeft(14)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
