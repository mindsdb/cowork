// Hand-drawn pixel maps rendered as crisp SVG rect grids.
//
// Each sprite is a list of equal-length strings; every character is one
// pixel. '.' is transparent, any other character indexes into the
// sprite's palette. Rendering as SVG (rather than PNG assets) keeps the
// sprites theme-able, scale-free, and inside the renderer's strict CSP
// (no external images).

interface SpriteDef {
  palette: Record<string, string>;
  rows: string[];
}

// ── Coworker cartridges ──────────────────────────────────────────────

// ANTON — the green robot.
const ANTON: SpriteDef = {
  palette: {
    g: '#4ade80', // body green
    d: '#16652f', // visor dark
    w: '#d9ffe6', // eye light
    k: '#0a0a13', // mouth slot
  },
  rows: [
    '....gg....gg....',
    '....gg....gg....',
    '..gggggggggggg..',
    '..gggggggggggg..',
    '..ggddddddddgg..',
    '..ggdwwddwwdgg..',
    '..ggdwwddwwdgg..',
    '..ggddddddddgg..',
    '..gggggggggggg..',
    '..ggg.kkkk.ggg..',
    '..gggggggggggg..',
    '...gggggggggg...',
    '....gg....gg....',
    '....gg....gg....',
    '...ggg....ggg...',
  ],
};

// HERMES — monochrome pixel portrait of the Nous "Hermes" mark, matching
// the black-&-white brand logo: dark-grey bob, white hair-shine streaks,
// white headband, light-grey face with one eye, and a white "N" collar
// tab. Greyscale only (no colour). 18×18.
const HERMES: SpriteDef = {
  palette: {
    h: '#3c3f4d', // hair (dark grey — reads on the dark card)
    w: '#f2f4fa', // white: shine streaks, headband, collar tab
    s: '#cdd0da', // skin (light grey, separates from hair)
    o: '#898d9b', // mid-grey shadow / lips / contour
    e: '#14141c', // eye / lash / tab letter
  },
  rows: [
    '....hhhhhhhhhh....',
    '..hhhhhhhhhhhhhh..',
    '.hhhhhhhhhhhhhhhh.',
    '.hhhwwwwwwwwhhhhh.',
    '.hhhhhhhhhhhhhhhhh',
    'hhwwwhhhwwwhhhhhhh',
    'hhhhhhhhhhhhhhhhhh',
    '.hssssshhhhhhhhhhh',
    '.hssessshhhhhhhhhh',
    '.hsseossshhhhhhhhh',
    '.hsssssshhhhhhhhhh',
    '.hossosshhhhhhhhhh',
    '.hhssooshhhhhhhhhh',
    '..hhssshhhhhhhhhhh',
    '...hhsshhhhhhhhh..',
    '..hhwwwwhhhhhhhh..',
    '..hhwewhhhhhhhhh..',
    '...hhhhhhhhhhhh...',
  ],
};

// OPENCLAW — pixel lobster (transcribed from the supplied logo): red
// body with a darker outline, lighter claws either side, and two eyes
// with white glints. 16×16.
const OPENCLAW: SpriteDef = {
  palette: {
    m: '#3a0a0d', // outline
    r: '#ff4f40', // body
    c: '#ff775f', // claws
    e: '#081016', // eye
    w: '#f5fbff', // eye glint
  },
  rows: [
    '................',
    '................',
    '....mmmmmmmm....',
    '...m.rrrrrr.m...',
    '..m.rrwrrwrr.m..',
    '.mcrrrerrerrrcm.',
    '.ccrrrrrrrrrrcc.',
    '.mcrrrrrrrrrrcm.',
    '..m.rrrrrrrr.m..',
    '...m.rrrrrr.m...',
    '....m...........',
    '.....mmmmmm.....',
    '....mrrrrrrm....',
    '...m..rrrr..m...',
    '.....mmmmmm.....',
    '................',
  ],
};

// ??? — the mystery cartridge.
const MYSTERY: SpriteDef = {
  palette: {
    p: '#a78bfa', // frame purple
    w: '#efe9ff', // question mark
  },
  rows: [
    'pppppppppppppppp',
    'pppppppppppppppp',
    'pp............pp',
    'pp....wwww....pp',
    'pp...ww..ww...pp',
    'pp...ww..ww...pp',
    'pp......ww....pp',
    'pp.....ww.....pp',
    'pp.....ww.....pp',
    'pp............pp',
    'pp.....ww.....pp',
    'pp.....ww.....pp',
    'pp............pp',
    'pppppppppppppppp',
    'pppppppppppppppp',
  ],
};

// ── Small icons ──────────────────────────────────────────────────────

// Gold coin (success / unlock moments).
const COIN: SpriteDef = {
  palette: {
    y: '#fbbf24',
    o: '#b87708',
    w: '#fff3cf',
  },
  rows: [
    '...yyyyyy...',
    '..yyyyyyyy..',
    '.yywwyyyyyy.',
    'yywyyyooyyyy',
    'yywyyyooyyyy',
    'yyyyyyooyyyy',
    'yyyyyyooyyyy',
    'yyyyyyooyyyy',
    'yyyyyyooyyyy',
    '.yyyyyyyyyo.',
    '..yyyyyyoo..',
    '...yyyyyy...',
  ],
};

// Quest scroll (terms / license).
const SCROLL: SpriteDef = {
  palette: {
    p: '#e8dcb8', // parchment
    s: '#a8946a', // parchment shade
    r: '#3dd6f5', // ribbon/rod caps
    t: '#5b5d78', // text lines
  },
  rows: [
    'rr..........rr',
    'rrpppppppppprr',
    'rr..........rr',
    '..pppppppppp..',
    '..p.tttttt.p..',
    '..pppppppppp..',
    '..p.tttt...p..',
    '..pppppppppp..',
    '..p.tttttt.p..',
    '..pppppppppp..',
    '..p.ttt....p..',
    '..spppppppps..',
    'rr..........rr',
    'rrpppppppppprr',
    'rr..........rr',
  ],
};

// Wrench (setup / install).
const WRENCH: SpriteDef = {
  palette: {
    s: '#b9bdd4',
    d: '#5b5d78',
  },
  rows: [
    '....ss..ss..',
    '....ss..ss..',
    '....ssssss..',
    '.....ssss...',
    '......ss....',
    '......ss....',
    '......ss....',
    '......ss....',
    '.....ssss...',
    '....ssddss..',
    '....ssddss..',
    '.....ssss...',
  ],
};

// Power bolt (provider hookup).
const BOLT: SpriteDef = {
  palette: {
    y: '#fbbf24',
    w: '#fff3cf',
  },
  rows: [
    '......wyyy..',
    '.....wyyy...',
    '....wyyy....',
    '...wyyy.....',
    '..wyyyyyyyy.',
    '.wyyyyyyyy..',
    '....wyyy....',
    '...wyyy.....',
    '..wyyy......',
    '.wyyy.......',
    'wyyy........',
    'yyy.........',
  ],
};

// Heart (you'll need it).
const HEART: SpriteDef = {
  palette: {
    r: '#f87168',
    w: '#ffd9d6',
  },
  rows: [
    '.rr....rr.',
    'rwrr..rrrr',
    'rwwrrrrrrr',
    'rwrrrrrrrr',
    'rrrrrrrrrr',
    '.rrrrrrrr.',
    '..rrrrrr..',
    '...rrrr...',
    '....rr....',
  ],
};

const SPRITES = {
  anton: ANTON,
  hermes: HERMES,
  openclaw: OPENCLAW,
  mystery: MYSTERY,
  coin: COIN,
  scroll: SCROLL,
  wrench: WRENCH,
  bolt: BOLT,
  heart: HEART,
} as const;

export type SpriteName = keyof typeof SPRITES;

export function PixelSprite({
  name,
  size = 96,
  bob = false,
  title,
  style,
}: {
  name: SpriteName;
  /** Rendered width in px; height follows the pixel grid's aspect. */
  size?: number;
  /** Idle two-frame bob, like a character waiting on a select screen. */
  bob?: boolean;
  title?: string;
  style?: React.CSSProperties;
}) {
  const def = SPRITES[name];
  const cols = def.rows[0].length;
  const rowCount = def.rows.length;
  const height = (size / cols) * rowCount;

  const rects: React.ReactNode[] = [];
  def.rows.forEach((row, y) => {
    // Run-length merge horizontal spans of the same colour so the DOM
    // stays small (a 16x16 sprite is ~40 rects instead of 256).
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.') { x++; continue; }
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      rects.push(
        <rect key={`${x}-${y}`} x={x} y={y} width={run} height={1} fill={def.palette[ch]} />
      );
      x += run;
    }
  });

  return (
    <span className={`arc-sprite${bob ? ' arc-bob' : ''}`} style={style} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <svg
        width={size}
        height={height}
        viewBox={`0 0 ${cols} ${rowCount}`}
        shapeRendering="crispEdges"
        xmlns="http://www.w3.org/2000/svg"
      >
        {rects}
      </svg>
    </span>
  );
}
