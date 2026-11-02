// On-screen controls for phones and tablets. Shown automatically on the first touch.

export function initTouch(game, onKey) {
  const t = { active: false, x: 0, y: 0, hold: {} };
  const root = document.getElementById('touch');
  const stick = document.getElementById('tStick');
  const knob = document.getElementById('tKnob');

  const activate = () => {
    if (t.active) return;
    t.active = true;
    game.touchMode = true;
    game.mouseFlight = false;
    document.body.classList.add('touch');
    root.classList.remove('hidden');
  };
  addEventListener('touchstart', activate, { passive: true });

  // Virtual stick
  let sid = null;
  const moveStick = e => {
    const r = stick.getBoundingClientRect();
    const R = r.width / 2;
    let dx = (e.clientX - (r.left + R)) / R, dy = (e.clientY - (r.top + R)) / R;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    t.x = dx; t.y = dy;
    knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
  };
  stick.addEventListener('pointerdown', e => {
    sid = e.pointerId;
    try { stick.setPointerCapture(sid); } catch { /* capture is optional */ }
    moveStick(e);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', e => { if (e.pointerId === sid) moveStick(e); });
  const endStick = e => { if (e.pointerId !== sid) return; sid = null; t.x = t.y = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  // Buttons: data-hold keeps a flag while pressed, data-key sends a key press.
  for (const b of root.querySelectorAll('[data-hold],[data-key]')) {
    const hold = b.dataset.hold, key = b.dataset.key;
    b.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      b.classList.add('on');
      if (hold) t.hold[hold] = true;
      if (key) onKey(key);
    });
    const up = () => { b.classList.remove('on'); if (hold) t.hold[hold] = false; };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  }
  return t;
}
