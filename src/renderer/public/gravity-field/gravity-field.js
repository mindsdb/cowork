/*!
 * gravity-field.js
 * ----------------
 * A subtle animated background: a dot grid where dots morph into
 * arrowheads pointing at a slow-drifting "center of mass." When the
 * cursor enters the surface, it becomes the target the mass eases
 * toward — so the user's pointer gently steers the field.
 *
 * Zero dependencies. ~3 KB minified. Works in any modern browser
 * (and Electron renderer). Vanilla — no build step.
 *
 * Usage:
 *   <canvas id="bg"></canvas>
 *   <script src="gravity-field.js"></script>
 *   <script>
 *     const field = GravityField.mount(document.getElementById('bg'), {
 *       theme: 'dark',         // 'dark' | 'light'
 *       spacing: 26,           // grid cell size in CSS px
 *       trackPointer: true,    // cursor steers center of mass
 *     });
 *     // later: field.setTheme('light'); field.destroy();
 *   </script>
 *
 * License: MIT — do whatever you want with it.
 */
(function (global) {
  'use strict';

  // -------- Theme palettes --------------------------------------------------
  const PALETTES = {
    dark: {
      // background colour the canvas paints behind itself (CSS handles the
      // page background; the canvas is transparent — these are the *ink*
      // colours used to draw the field on top of the page background).
      dot:    a => `rgba(160, 190, 202, ${a})`,
      stroke: a => `rgba(160, 190, 202, ${a})`,
      glow:   a => `rgba(31, 156, 176, ${a})`,
    },
    light: {
      // Full-strength ink. Route-aware quieting lives in
      // gravity-field.css: `body.gf-quiet` dims the canvas on dense
      // work surfaces while the home stage keeps the full field.
      dot:    a => `rgba(85, 102, 109, ${a})`,
      stroke: a => `rgba(85, 102, 109, ${a})`,
      glow:   a => `rgba(31, 156, 176, ${a})`,
    },
  };

  // -------- Mount -----------------------------------------------------------
  function mount(canvas, opts) {
    if (!canvas || canvas.tagName !== 'CANVAS') {
      throw new Error('GravityField.mount: first argument must be a <canvas> element');
    }
    const o = Object.assign({
      theme: 'dark',
      spacing: 26,
      trackPointer: true,
      pointerTarget: null,   // element to listen on; defaults to canvas's parent
      maxDpr: 2,             // cap devicePixelRatio for perf
    }, opts || {});

    const ctx = canvas.getContext('2d');
    let palette = PALETTES[o.theme] || PALETTES.dark;
    let raf = 0;
    let running = true;
    const start = performance.now();
    // Cap the draw rate
    // visually but doubles as a steady GPU/CPU sink for an always-on tab.
    const FRAME_INTERVAL = 1000 / 4;
    let lastDraw = 0;

    // Smoothed center of mass + cursor.
    const com = { x: 0, y: 0, ready: false };
    const cursorEased = { x: -9999, y: -9999 };
    const mouse = { x: -9999, y: -9999, active: false };

    // -------- Pointer handling ---------------------------------------------
    const pointerHost = o.pointerTarget || canvas.parentElement || canvas;
    function onMove(e) {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.active = true;
    }
    function onLeave() {
      mouse.active = false;
      mouse.x = -9999;
      mouse.y = -9999;
    }
    if (o.trackPointer) {
      pointerHost.addEventListener('mousemove', onMove);
      pointerHost.addEventListener('mouseleave', onLeave);
    }

    // -------- Sizing -------------------------------------------------------
    function resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr);
      canvas.width = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // -------- Frame --------------------------------------------------------
    function frame(now) {
      if (!running) return;
      if (now - lastDraw < FRAME_INTERVAL) {
        raf = requestAnimationFrame(frame);
        return;
      }
      lastDraw = now;
      const t = (now - start) / 1000;
      const r = canvas.getBoundingClientRect();
      const w = r.width;
      const h = r.height;
      ctx.clearRect(0, 0, w, h);

      // Autonomous target — two slow orbits blended by a slow weight.
      const ax = w * (0.5 + 0.30 * Math.sin(t * 0.17));
      const ay = h * (0.5 + 0.26 * Math.cos(t * 0.13 + 0.7));
      const bx = w * (0.5 + 0.26 * Math.cos(t * 0.11 + 1.3));
      const by = h * (0.5 + 0.28 * Math.sin(t * 0.15 + 2.1));
      const blend = 0.5 + 0.5 * Math.sin(t * 0.07);
      let targetX = ax * blend + bx * (1 - blend);
      let targetY = ay * blend + by * (1 - blend);

      // Eased cursor — when active, IT becomes the target. Same downstream
      // easing applies, so cursor-driven motion looks identical to drift.
      const tx = mouse.active ? mouse.x : -9999;
      const ty = mouse.active ? mouse.y : -9999;
      cursorEased.x += (tx - cursorEased.x) * 0.06;
      cursorEased.y += (ty - cursorEased.y) * 0.06;
      if (mouse.active && cursorEased.x > -1000) {
        targetX = cursorEased.x;
        targetY = cursorEased.y;
      }

      // Critically-damped low-pass on the mass.
      if (!com.ready) { com.x = targetX; com.y = targetY; com.ready = true; }
      const EASE = 0.04;
      com.x += (targetX - com.x) * EASE;
      com.y += (targetY - com.y) * EASE;
      const cmx = com.x;
      const cmy = com.y;

      // -------- Draw the field --------------------------------------------
      const spacing = o.spacing;
      const NEAR_FADE  = 30;
      const MID        = 160;
      const FAR_VANISH = 520;

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let x = spacing / 2; x < w; x += spacing) {
        for (let y = spacing / 2; y < h; y += spacing) {
          const dx = cmx - x;
          const dy = cmy - y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = dx / dist;
          const ny = dy / dist;

          // Arrowhead presence: 0 far, 1 in mid-range, 0 at very core.
          let arrowness;
          if (dist < NEAR_FADE) {
            arrowness = dist / NEAR_FADE;
          } else if (dist < MID) {
            arrowness = 1;
          } else {
            const u = Math.max(0, Math.min(1, (dist - MID) / (FAR_VANISH - MID)));
            arrowness = 1 - (u * u * (3 - 2 * u));
          }

          // Distance-based visibility: dots fade out toward the edges.
          let distFade = 1;
          if (dist > MID) {
            const u = Math.max(0, Math.min(1, (dist - MID) / (FAR_VANISH - MID)));
            distFade = 1 - (u * u * (3 - 2 * u));
          }
          const baseA = 0.18 * distFade;

          if (arrowness < 0.04) {
            // Pure dot.
            ctx.fillStyle = palette.dot(baseA);
            ctx.beginPath();
            ctx.arc(x, y, 1.0, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // Arrowhead chevron pointing at mass.
            const headSize = 4.0 * arrowness;
            const halfAngle = Math.PI / 5;
            const lead = 0.6 * headSize;
            const tipX = x + nx * lead;
            const tipY = y + ny * lead;
            const back = headSize;
            const ca = Math.cos(halfAngle);
            const sa = Math.sin(halfAngle);
            const bxr = -nx, byr = -ny;
            const w1x = tipX + (bxr * ca - byr * sa) * back;
            const w1y = tipY + (bxr * sa + byr * ca) * back;
            const w2x = tipX + (bxr * ca + byr * sa) * back;
            const w2y = tipY + (-bxr * sa + byr * ca) * back;

            ctx.strokeStyle = palette.stroke(baseA);
            ctx.lineWidth = 1 + arrowness * 0.2;
            ctx.beginPath();
            ctx.moveTo(w1x, w1y);
            ctx.lineTo(tipX, tipY);
            ctx.lineTo(w2x, w2y);
            ctx.stroke();

            // Soft residual dot at base, fading as arrowness grows.
            const dotA = baseA * (1 - arrowness * 0.85);
            if (dotA > 0.04) {
              ctx.fillStyle = palette.dot(dotA);
              ctx.beginPath();
              ctx.arc(x, y, 0.9, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      // Whisper-faint glow at the center of mass.
      const grad = ctx.createRadialGradient(cmx, cmy, 0, cmx, cmy, 240);
      grad.addColorStop(0, palette.glow(0.06));
      grad.addColorStop(1, palette.glow(0));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // -------- Pause when tab is hidden -------------------------------------
    function onVis() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    }
    document.addEventListener('visibilitychange', onVis);

    // -------- Public API ---------------------------------------------------
    return {
      setTheme(name) {
        palette = PALETTES[name] || PALETTES.dark;
      },
      setSpacing(n) { o.spacing = Math.max(8, n | 0); },
      destroy() {
        running = false;
        cancelAnimationFrame(raf);
        ro.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        if (o.trackPointer) {
          pointerHost.removeEventListener('mousemove', onMove);
          pointerHost.removeEventListener('mouseleave', onLeave);
        }
      },
    };
  }

  // -------- Export ---------------------------------------------------------
  const api = { mount: mount };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;          // CommonJS / Electron require
  }
  global.GravityField = api;        // browser global / Electron renderer
})(typeof window !== 'undefined' ? window : globalThis);
