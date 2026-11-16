const api = window.pet;

const petEl = document.getElementById('pet');
const flipEl = document.getElementById('flip');
const spriteEl = document.getElementById('sprite');
const bubbleEl = document.getElementById('bubble');
const shadowEl = document.getElementById('shadow');
const fxEl = document.getElementById('fx');

// Everything she can say comes from resources/scripts (sent by the main process). There are no
// built-in lines: a moment with no script folder is simply silent.
const CATEGORIES = ['greet', 'talk', 'poke', 'pat', 'pokeMany', 'drag', 'land', 'sleep', 'wake'];
const LINES = Object.fromEntries(CATEGORIES.map((c) => [c, []]));

// What she does when clicked. Each entry is a one-shot animation (see pet.css), an expression
// (\`mood\`: the first of these names the current outfit has a frame for) and an emote badge that is
// only used when there is no such frame, since the frames carry their own marks. \`chibi\` limits
// an entry to the small sprite, where there is room to tumble.
const REACTIONS = {
  poke: [
    { anim: 'hop', ms: 600, emote: '!', mood: ['surprised', 'turn'] },
    { anim: 'tilt', ms: 950, emote: '?', mood: ['thinking', 'point', 'binoculars', 'sit'] },
    { anim: 'wiggle', ms: 800, emote: '♪', mood: ['smile', 'wave', 'idea', 'reach', 'cheer'] },
    { anim: 'spin', ms: 800, emote: '✦', mood: ['laugh', 'sparkle', 'proud', 'joy', 'cheer'] },
    { anim: 'nod', ms: 700, mood: ['smile', 'salute', 'laugh', 'reach'] },
    { anim: 'flip', ms: 900, emote: '✦', mood: ['cheer', 'joy', 'laugh'], chibi: true },
  ],
  pat: [
    { anim: 'sway', ms: 1200, emote: '♥', mood: ['love', 'joy', 'offer'] },
    { anim: 'nod', ms: 700, emote: '♪', mood: ['laugh', 'joy', 'cheer', 'proud', 'wave', 'salute'] },
    { anim: 'shrink', ms: 850, emote: '💦', mood: ['shy', 'troubled', 'love', 'kneel'] },
  ],
  annoyed: [
    { anim: 'shake', ms: 600, emote: '💢', mood: ['angry'] },
    { anim: 'shrink', ms: 850, emote: '💦', mood: ['flustered', 'troubled', 'crying', 'shy'] },
    { anim: 'wiggle', ms: 800, emote: '💢', mood: ['pout', 'stern', 'sigh', 'angry'] },
    { anim: 'sway', ms: 1200, emote: '♥', mood: ['shy', 'love', 'kneel'] },
  ],
};
// Expressions that last as long as a state does.
const STATE_MOODS = { sleep: ['sleepy', 'rest'], drag: ['shocked', 'surprised'], fall: ['shocked', 'surprised'] };
// Expressions for moments that are not clicks, and how long they show.
const EVENT_MOODS = {
  greet: { mood: ['smile', 'wave', 'salute', 'cheer', 'reach'], ms: 4000 },
  talk: { mood: ['smile', 'reach', 'point', 'thinking', 'map'], ms: 4000 },
  land: { mood: ['cool', 'smug', 'proud', 'charge', 'joy', 'cheer'], ms: 2800 },
  wake: { mood: ['surprised', 'turn'], ms: 1600 },
};
// Small unprompted movements while she stands around, each with a passing expression.
const FIDGETS = [
  { anim: 'nod', ms: 700, mood: ['smile', 'salute'] },
  { anim: 'tilt', ms: 950, mood: ['thinking', 'map', 'binoculars'] },
  { anim: 'stretch', ms: 1100, mood: ['sigh', 'pout', 'drink', 'sit'] },
  { anim: 'wiggle', ms: 800, mood: ['smug', 'idea', 'sparkle', 'drink', 'binoculars', 'wave', 'cool'] },
];

let tempFrame = null; // expression frame from the latest reaction, until it wears off
let moodTimer = null;
let shownSrc = null;
let preloaded = [];

// The image for the first of \`names\` this outfit has a frame for, if any.
function frameFor(names) {
  const moods = (cfg && cfg.moods) || {};
  const name = (names || []).find((n) => moods[n]);
  return name ? moods[name] : null;
}

// On the full figure a different frame is a whole change of pose, so it is treated with more
// care than a chibi's change of face: never while she is speaking, each pose is held for a
// while, and voluntary changes are spaced out.
const FULL_POSE_GAP = 30000; // at least this long between changes of pose
const FULL_POSE_HOLD = 6000; // a pose stays at least this long
let lastPoseChange = 0;
let revertAfterLine = false; // the pose's time ran out mid-line; go back to neutral when she finishes
const isFull = () => !!cfg && cfg.form.endsWith('/full');

// The full figure does not stand in one pose: every so often she moves on to another, going
// through all of them in a shuffled order. Never mid-line, mid-reaction or while carried.
const SLEEP_POSES = ['sleepy', 'rest']; // kept for when she is actually asleep
let restFrame = null; // the pose she is resting in now (null: the neutral one)
let poseQueue = [];
let nextPoseAt = 0;

function rotatePose() {
  if (!isFull() || !cfg.rotate || Date.now() < nextPoseAt) return;
  if (talking || pressed || tempFrame || (state !== 'idle' && state !== 'walk')) return;
  if (!poseQueue.length) {
    const moods = cfg.moods || {};
    poseQueue = [null, ...Object.keys(moods).filter((n) => !SLEEP_POSES.includes(n)).map((n) => moods[n])];
    for (let i = poseQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [poseQueue[i], poseQueue[j]] = [poseQueue[j], poseQueue[i]];
    }
    if (poseQueue.length > 1 && poseQueue[0] === restFrame) poseQueue.push(poseQueue.shift());
  }
  restFrame = poseQueue.shift();
  nextPoseAt = Date.now() + cfg.rotate;
  refreshFace();
}

function refreshFace(force) {
  if (!cfg) return;
  if (!force && isFull() && talking) return; // hold the pose until the line is over
  // what is happening to her right now (asleep, carried) outranks a leftover click expression
  const src = frameFor(STATE_MOODS[state]) || tempFrame || restFrame || cfg.src;
  if (src === shownSrc) return;
  shownSrc = src;
  spriteEl.src = src;
  placeBubble();
  const moods = cfg.moods || {};
  console.log('frame ->', Object.keys(moods).find((n) => moods[n] === src) || 'neutral');
}

// Shows an expression for \`ms\`. Returns whether it was shown (false: no such frame for this
// outfit, or a full-figure pose change was held back).
function setMood(names, ms) {
  const frame = frameFor(names);
  if (isFull()) {
    if (!frame || talking || Date.now() - lastPoseChange < FULL_POSE_GAP) return false;
    lastPoseChange = Date.now();
    ms = Math.max(ms, FULL_POSE_HOLD);
  }
  tempFrame = frame;
  revertAfterLine = false;
  clearTimeout(moodTimer);
  moodTimer = setTimeout(() => {
    if (isFull() && talking) {
      revertAfterLine = true;
      return;
    }
    tempFrame = null;
    refreshFace();
  }, ms);
  refreshFace();
  return !!tempFrame;
}

// Called when a line ends: now the full figure may change pose again.
function afterLine() {
  if (revertAfterLine) {
    revertAfterLine = false;
    tempFrame = null;
  }
  refreshFace();
}
const ONE_SHOTS = ['hop', 'squash', 'nod', 'tilt', 'wiggle', 'shake', 'spin', 'sway', 'stretch', 'shrink', 'flip'];

let ink = { top: 0, bottom: 1 }; // vertical extent of the artwork, as fractions of the sprite box
let lastPressV = 0.5; // where on the sprite the last click landed (0 = top, 1 = bottom)
let lastReaction = null;
let shotTimer = null;
let nextFidget = Date.now() + 8000;

let cfg = null;
let alpha = null; // RGBA pixels of the current sprite, for per-pixel hit testing
let natW = 0;
let natH = 0;
let face = -1; // which way she looks (1 right, -1 left); the main process keeps it toward the screen centre
let state = 'idle';
let hovering = false;
let pressed = false;
let pokeCount = 0;
let pokeTimer = null;
let bubbleTimer = null;
let lastLine = '';

const pick = (list) => {
  let line;
  do line = list[Math.floor(Math.random() * list.length)];
  while (list.length > 1 && line === lastLine);
  lastLine = line;
  return line;
};

let voice = null; // the Audio currently playing, if any
let voiceOn = true;
let bubbleBottom = 0; // where the bubble sits when it fits: just above her head
let bubbleBase = null; // { floor, h, top }: what bubbleBottom is worked out from
// Every expression/pose frame as it is drawn in the sprite box: its opaque pixels (for clicks)
// and how high it reaches (for the bubble). Poses differ a lot in outline from the neutral one.
let frameMaps = new Map();

// Puts the bubble just above the head of the frame on show, so no pose is ever covered by it.
function placeBubble() {
  if (!bubbleBase) return;
  const m = frameMaps.get(shownSrc);
  bubbleBottom = bubbleBase.floor + bubbleBase.h * (1 - (m ? m.top : bubbleBase.top)) + 10;
  if (!bubbleEl.classList.contains('show')) {
    bubbleEl.style.bottom = Math.min(bubbleBottom, window.innerHeight - 50) + 'px';
  }
}

async function mapFrames(c) {
  const maps = new Map();
  const w = 240;
  const h = Math.max(1, Math.round((w * natH) / natW));
  const srcs = Object.values(c.moods || {});
  for (let i = 0; i < srcs.length; i++) {
    const img = preloaded[i];
    try {
      await img.decode();
    } catch {
      continue;
    }
    if (cfg !== c) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // same fit as the <img>: contained in the box, centred, feet on the floor
    const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    ctx.drawImage(img, (w - dw) / 2, h - dh, dw, dh);
    const data = ctx.getImageData(0, 0, w, h).data;
    let top = 0;
    const rowHasInk = (y) => {
      for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 60) return true;
      return false;
    };
    while (top < h - 1 && !rowHasInk(top)) top++;
    maps.set(srcs[i], { w, h, data, top: top / h });
  }
  frameMaps = maps;
  placeBubble();
}

function stopVoice() {
  if (!voice) return;
  voice.pause();
  voice = null;
}

// A line is either plain text or { text, audio } from resources/scripts. With audio, the
// bubble stays up for as long as she is speaking.
// Tell the main process whether a line is in progress (bubble up or voice playing), so it
// does not send her to sleep mid-conversation.
let talking = false;
function setTalking(on) {
  if (on === talking) return;
  talking = on;
  api.talking(on);
  if (!on) afterLine();
}

let lineKind = null; // what the line in progress answers: 'click' (something you did) or 'idle'

// A line is { text, audio } from the script folder. The bubble is tied to her voice: it goes up
// when the clip actually starts playing and comes down when it ends. Without a clip (or with
// the voice switched off) the text is shown on a timer instead.
function say(line, ms = 3600, kind = 'idle') {
  if (!line) return; // no script for this moment
  const text = typeof line === 'string' ? line : line.text;
  const audio = typeof line === 'string' ? null : line.audio;
  const show = () => text && bubbleEl.classList.add('show');
  const hide = () => {
    bubbleEl.classList.remove('show');
    lineKind = null;
    setTalking(false);
  };

  stopVoice();
  clearTimeout(bubbleTimer);
  bubbleEl.classList.remove('show');
  setTalking(true);
  lineKind = kind;

  if (text) {
    bubbleEl.textContent = text;
    // long lines grow upward; keep the whole bubble inside the window
    const fit = window.innerHeight - bubbleEl.offsetHeight - 6;
    bubbleEl.style.bottom = Math.max(0, Math.min(bubbleBottom, fit)) + 'px';
    console.log('bubble', fit >= bubbleBottom ? 'clear of her head' : 'OVERLAPS by ' + Math.round(bubbleBottom - fit));
    ms = Math.max(ms, text.length * 100);
  }

  if (!audio || !voiceOn) {
    show();
    bubbleTimer = setTimeout(hide, ms);
    return;
  }

  const clip = new Audio(audio);
  const asked = performance.now();
  voice = clip;
  const current = () => voice === clip; // false once another line has replaced this one
  clip.addEventListener(
    'playing',
    () => {
      if (!current()) return;
      show();
      console.log('voice playing', clip.duration.toFixed(1) + 's, bubble up after', Math.round(performance.now() - asked) + 'ms');
    },
    { once: true },
  );
  clip.addEventListener('ended', () => {
    if (!current()) return;
    voice = null;
    console.log('voice ended, bubble down');
    bubbleTimer = setTimeout(hide, 400);
  });
  const failed = () => {
    if (!current()) return;
    voice = null;
    show(); // no sound, so fall back to showing the text on a timer
    bubbleTimer = setTimeout(hide, ms);
  };
  clip.addEventListener('error', failed);
  clip.play().catch(failed);
}

function hush() {
  stopVoice();
  clearTimeout(bubbleTimer);
  bubbleEl.classList.remove('show');
  lineKind = null;
  setTalking(false);
}

function oneShot(cls, ms) {
  petEl.classList.remove(...ONE_SHOTS);
  void petEl.offsetWidth; // restart the animation
  petEl.classList.add(cls);
  clearTimeout(shotTimer);
  shotTimer = setTimeout(() => petEl.classList.remove(cls), ms);
}

function emote(symbol) {
  const r = petEl.getBoundingClientRect();
  const e = document.createElement('span');
  e.className = 'emote';
  e.textContent = symbol;
  e.style.left = Math.min(r.left + r.width * 0.7, window.innerWidth - 40) + 'px';
  e.style.top = Math.max(r.top + r.height * ink.top - 6, 4) + 'px';
  fxEl.appendChild(e);
  setTimeout(() => e.remove(), 1400);
}

function react(kind) {
  const isChibi = !!cfg && cfg.form.endsWith('/chibi');
  const options = REACTIONS[kind].filter((r) => (isChibi || !r.chibi) && r !== lastReaction);
  const r = options[Math.floor(Math.random() * options.length)];
  lastReaction = r;
  oneShot(r.anim, r.ms);
  const framed = setMood(r.mood, Math.max(r.ms + 900, 2200));
  if (framed) return; // the frame already shows the heart, sweat drop, etc.
  if (r.emote === '♥') hearts(3);
  else if (r.emote) emote(r.emote);
}

// The top of the figure counts as her head: clicking there is a pat rather than a poke.
function clickedHead() {
  const t = (lastPressV - ink.top) / Math.max(ink.bottom - ink.top, 0.01);
  const isChibi = !!cfg && cfg.form.endsWith('/chibi');
  return t < (isChibi ? 0.45 : 0.22);
}

function hearts(n) {
  const r = petEl.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    const h = document.createElement('span');
    h.className = 'heart';
    h.textContent = '♥';
    h.style.left = r.left + r.width * (0.25 + Math.random() * 0.5) + 'px';
    h.style.top = r.top + r.height * (0.1 + Math.random() * 0.25) + 'px';
    h.style.animationDelay = i * 0.12 + 's';
    fxEl.appendChild(h);
    setTimeout(() => h.remove(), 1400 + i * 120);
  }
}


function updateFlip() {
  const flipped = cfg && face * cfg.faces < 0;
  flipEl.style.transform = flipped ? 'scaleX(-1)' : '';
}

function isFlipped() {
  return !!cfg && face * cfg.faces < 0;
}

// True when the cursor is over an opaque pixel of the sprite.
function hit(e) {
  if (!alpha) return false;
  const r = petEl.getBoundingClientRect();
  let u = (e.clientX - r.left) / r.width;
  const v = (e.clientY - r.top) / r.height;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
  if (isFlipped()) u = 1 - u;
  const m = frameMaps.get(shownSrc); // the pose on show, when it is not the neutral one
  if (m) return m.data[(Math.floor(v * m.h) * m.w + Math.floor(u * m.w)) * 4 + 3] > 24;
  const x = Math.floor(u * natW);
  const y = Math.floor(v * natH);
  return alpha[(y * natW + x) * 4 + 3] > 24;
}

function setHover(on) {
  if (on === hovering) return;
  hovering = on;
  api.ignore(!on);
  document.body.style.cursor = on ? 'grab' : '';
}

api.on('config', async (c) => {
  cfg = c;
  for (const key of CATEGORIES) {
    const list = (c.lines && c.lines[key]) || [];
    // a line with audio but no text has nothing to show when the voice is off
    LINES[key] = list.filter((s) => s && (s.text || (s.audio && c.voice !== false)));
  }
  voiceOn = c.voice !== false;
  if (!voiceOn) stopVoice();
  petEl.classList.toggle('card', !!c.card);
  tempFrame = null;
  restFrame = null;
  poseQueue = [];
  nextPoseAt = Date.now() + (c.rotate || 0);
  frameMaps = new Map();
  clearTimeout(moodTimer);
  // decode the expression frames up front so the first swap does not flicker
  preloaded = Object.values(c.moods || {}).map((src) => Object.assign(new Image(), { src }));
  petEl.classList.toggle('own-zzz', !!(c.moods && c.moods.sleepy)); // that frame draws its own Zs
  shownSrc = null;
  lastPoseChange = 0;
  revertAfterLine = false;
  refreshFace(true);

  // Measure the neutral sprite from its own copy: the visible <img> may switch to an
  // expression frame at any moment (she is "shocked" while falling in at launch).
  const base = new Image();
  base.src = c.src;
  await base.decode();
  if (cfg !== c) return; // a newer config arrived while this one was decoding

  natW = base.naturalWidth;
  natH = base.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = natW;
  canvas.height = natH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(base, 0, 0);
  alpha = ctx.getImageData(0, 0, natW, natH).data;

  // find the artwork's real extents so her feet sit on the floor and the bubble sits on her head
  let top = 0;
  let bottom = natH - 1;
  let left = natW;
  let right = 0;
  const rowHasInk = (y) => {
    for (let x = 0; x < natW; x++) if (alpha[(y * natW + x) * 4 + 3] > 60) return true;
    return false;
  };
  while (top < natH - 1 && !rowHasInk(top)) top++;
  while (bottom > 0 && !rowHasInk(bottom)) bottom--;
  // footprint width from the lowest 12% of the figure, for the shadow
  const footFrom = Math.floor(bottom - (bottom - top) * 0.12);
  for (let y = footFrom; y <= bottom; y++) {
    for (let x = 0; x < natW; x++) {
      if (alpha[(y * natW + x) * 4 + 3] > 60) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  ink = { top: top / natH, bottom: (bottom + 1) / natH };

  const k = c.w / natW;
  const padBottom = (natH - 1 - bottom) * k;

  petEl.style.width = c.w + 'px';
  petEl.style.height = c.h + 'px';
  // c.foot is empty room kept below her feet so a lean never dips out of the window
  petEl.style.bottom = c.foot - padBottom + 'px';
  shadowEl.style.bottom = c.foot + 1 + 'px';
  bubbleBase = { floor: c.foot - padBottom, h: c.h, top: top / natH };
  placeBubble();

  const footW = Math.max(40, (right - left) * k * 1.1);
  shadowEl.style.width = footW + 'px';
  shadowEl.style.marginLeft = -footW / 2 + 'px';
  shadowEl.style.height = Math.max(8, footW * 0.14) + 'px';

  updateFlip();
  mapFrames(c);
});

api.on('state', (s) => {
  state = s.state;
  face = s.face;
  petEl.className = petEl.className
    .split(' ')
    .filter((cName) => !cName.startsWith('state-'))
    .concat('state-' + state)
    .join(' ');
  // no ground shadow while she is carried, falling, or parked above the floor
  document.body.classList.toggle('airborne', state === 'drag' || state === 'fall' || !!s.floating);
  updateFlip();
  refreshFace();
});

api.on('event', (kind) => {
  const face = EVENT_MOODS[kind];
  if (face && !(kind === 'talk' && voice)) setMood(face.mood, face.ms);
  switch (kind) {
    case 'greet':
      say(pick(LINES.greet), 4500);
      break;
    case 'talk':
      if (voice) break; // never talk over a voiced line with idle chatter
      say(pick(LINES.talk));
      break;
    case 'poke': {
      pokeCount++;
      clearTimeout(pokeTimer);
      pokeTimer = setTimeout(() => (pokeCount = 0), 4000);
      // She always reacts, but if she is still answering an earlier click she finishes that
      // line instead of starting a new one over it. Idle chatter does give way to a click.
      const answer = (list, ms) => {
        if (!(talking && lineKind === 'click')) say(pick(list), ms, 'click');
      };
      if (pokeCount >= 4) {
        react('annoyed');
        answer(LINES.pokeMany.length ? LINES.pokeMany : LINES.poke, 3600);
      } else if (clickedHead()) {
        react('pat');
        answer(LINES.pat.length ? LINES.pat : LINES.poke, 2600); // no head-pat line: use a touch line
      } else {
        react('poke');
        answer(LINES.poke, 2400);
      }
      break;
    }
    case 'drag':
      say(pick(LINES.drag), 2600);
      break;
    case 'bounce':
      oneShot('squash', 380);
      break;
    case 'land':
      oneShot('squash', 380);
      say(pick(LINES.land), 2600, 'click');
      break;
    case 'sleep':
      say(pick(LINES.sleep), 2600);
      break;
    case 'wake':
      oneShot('hop', 600);
      say(pick(LINES.wake));
      break;
    default:
      hush();
  }
});

// The window ignores the mouse by default (moves are still forwarded), so only the
// opaque part of the sprite ever blocks clicks to whatever is underneath.
window.addEventListener('mousemove', (e) => {
  if (pressed) return;
  setHover(hit(e));
});
document.addEventListener('mouseleave', () => {
  if (!pressed) setHover(false);
});

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !hit(e)) return;
  const box = petEl.getBoundingClientRect();
  lastPressV = (e.clientY - box.top) / box.height;
  pressed = true;
  document.body.style.cursor = 'grabbing';
  petEl.setPointerCapture(e.pointerId);
  api.press();
});

const endPress = (e) => {
  if (!pressed) return;
  pressed = false;
  document.body.style.cursor = hovering ? 'grab' : '';
  try {
    petEl.releasePointerCapture(e.pointerId);
  } catch {}
  api.release();
};
window.addEventListener('pointerup', endPress);
window.addEventListener('pointercancel', endPress);
window.addEventListener('blur', () => {
  if (pressed) endPress({ pointerId: 1 });
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (hit(e)) api.menu();
});

setInterval(() => {
  rotatePose();
  if (state !== 'idle' || pressed || Date.now() < nextFidget) return;
  const f = FIDGETS[Math.floor(Math.random() * FIDGETS.length)];
  oneShot(f.anim, f.ms);
  if (!isFull()) setMood(f.mood, f.ms + 1300); // the full figure changes pose on its own schedule
  nextFidget = Date.now() + 5000 + Math.random() * 8000;
}, 1000);

// Lets a test run trigger a click reaction without a real mouse: PET_DEMO=poke|pat|annoyed
api.on('demo', (kind) => {
  if (kind.startsWith('mood:')) {
    tempFrame = frameFor([kind.slice(5)]);
    refreshFace(true);
    // the longest line there is: the worst case for the bubble fitting above her head
    const all = CATEGORIES.flatMap((k) => LINES[k]).filter((l) => l.text);
    say(all.sort((a, b) => b.text.length - a.text.length)[0]);
    return;
  }
  react(kind);
  say(pick(LINES[kind === 'annoyed' ? 'pokeMany' : kind]));
});

api.ready();
