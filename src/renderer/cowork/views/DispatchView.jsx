import Ico from '../components/Icons';

function buildQrCells() {
  const size = 25;
  const cells = Array.from({ length: size * size }, () => 0);
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      cells[y * size + x] = rnd() > 0.52 ? 1 : 0;
    }
  }

  const setFinder = (cx, cy) => {
    for (let y = -3; y <= 3; y += 1) {
      for (let x = -3; x <= 3; x += 1) {
        const xx = cx + x;
        const yy = cy + y;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const ax = Math.abs(x);
        const ay = Math.abs(y);
        cells[yy * size + xx] = ax === 3 || ay === 3 || (ax <= 1 && ay <= 1) ? 1 : 0;
      }
    }
  };

  setFinder(3, 3);
  setFinder(size - 4, 3);
  setFinder(3, size - 4);
  return { cells, size };
}

const QR = buildQrCells();

function DecorativeQr() {
  const cell = 8;
  const pad = 4;
  const dim = QR.size * cell + pad * 2;

  return (
    <svg viewBox={`0 0 ${dim} ${dim}`} role="img" aria-label="Decorative pairing code">
      <rect width={dim} height={dim} fill="#fff" />
      {QR.cells.map((filled, index) => {
        if (!filled) return null;
        const x = index % QR.size;
        const y = Math.floor(index / QR.size);
        return (
          <rect
            key={`${x}-${y}`}
            x={pad + x * cell}
            y={pad + y * cell}
            width={cell}
            height={cell}
            fill="#0e0d0b"
          />
        );
      })}
    </svg>
  );
}

function PairingIllustration() {
  return (
    <div className="dispatch-illustration" aria-hidden="true">
      <svg width="56" height="76" viewBox="0 0 56 76" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="3" width="44" height="70" rx="8" />
        <path d="M22 8h12" />
        <path d="M14 20h28M14 28h20M14 36h24" />
      </svg>
      <svg className="dispatch-signal" width="60" height="30" viewBox="0 0 60 30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M2 18 C 12 4, 22 32, 34 16 S 54 6, 58 14" />
      </svg>
      <svg width="84" height="64" viewBox="0 0 84 64" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="10" y="6" width="64" height="42" rx="3" />
        <path d="M4 52h76l-4 6H8z" />
        <path d="m38 22 12 10-12 10" />
      </svg>
    </div>
  );
}

export default function DispatchView({ onSetUpLater, agentLabel = 'the agent' }) {
  return (
    <div className="dispatch-view">
      <header className="dispatch-top">Dispatch</header>
      <main className="dispatch-content">
        <section className="dispatch-pair" aria-labelledby="dispatch-title">
          <PairingIllustration />

          <h1 id="dispatch-title">Pair with the MindsHub Cowork Mobile app</h1>
          <p>
            Use the mobile app to talk to {agentLabel} while it works from your desktop.
            Scan the code to download it on your phone.
          </p>

          <div className="dispatch-qr">
            <DecorativeQr />
          </div>

          <div className="dispatch-actions">
            <button
              type="button"
              className="dispatch-btn dispatch-btn-primary"
              disabled
              aria-disabled="true"
            >
              {Ico.check(16)}
              <span>I'm signed in on my phone</span>
              <span className="dispatch-button-badge">Coming soon</span>
            </button>
            <button type="button" className="dispatch-btn dispatch-btn-ghost" onClick={onSetUpLater}>
              Set up later
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
