const { app, BrowserWindow, ipcMain, Menu, Tray, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const { pathToFileURL } = require('url');

const ASSETS = path.join(__dirname, 'assets');
const RESOURCES = path.join(__dirname, 'resources');
// Natural size, display scale and available expression frames of every sprite. Written when the
// sheets in resources/ are sliced into assets/<character>/<outfit>/<pose>/<mood>.png.
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ASSETS, 'manifest.json'), 'utf8'));

// resources = her folder under resources/ (scripts live in its scripts/ subfolder)
// faces = which way each sprite is drawn looking (1 right, -1 left), so she can be turned
//         toward the centre of the screen
const CHARACTERS = {
  bismarck: {
    label: 'Bismarck',
    resources: 'Bismarck',
    skins: {
      main: { label: 'Main', faces: { chibi: 1, full: -1 } },
      christmas: { label: 'Christmas', faces: { chibi: 1, full: 1 } },
      wedding: { label: 'Wedding', faces: { chibi: 1, full: -1 } }, // seated with her knees to the left
    },
  },
  cheshire: {
    label: 'Cheshire',
    resources: 'Cheshire',
    skins: {
      main: { label: 'Main', faces: { chibi: 1, full: -1 } },
      wedding: { label: 'Wedding', faces: { chibi: 1, full: 1 } },
    },
  },
};
const POSES = { chibi: { label: 'Chibi', speed: 1.2 }, full: { label: 'Full figure', speed: 0.7 } };
const formKey = () => `${settings.character}/${settings.skin}/${settings.pose}`;
const currentForm = () => ({
  ...MANIFEST[formKey()],
  speed: POSES[settings.pose].speed,
  faces: CHARACTERS[settings.character].skins[settings.skin].faces[settings.pose],
});
const scriptsDir = () => path.join(RESOURCES, CHARACTERS[settings.character].resources, 'scripts');
const SIZES = [
  { label: 'Small', value: 0.75 },
  { label: 'Normal', value: 1 },
  { label: 'Large', value: 1.5 },
];
const BUBBLE_SPACE = 160; // transparent room above the sprite for the speech bubble
const MIN_WIDTH = 300;
const GRAVITY = 0.9;
const TICK_MS = 16;

let win = null;
let galleryWin = null;
let tray = null;

let settings = { character: 'bismarck', skin: 'main', pose: 'chibi', scale: 1, stay: false, onTop: true, quiet: false, voice: true, gravity: false, anchor: null };
let settingsFile = null;

let state = 'idle'; // idle | walk | sleep | drag | fall | react
let dir = 1; // walking direction
let face = -1; // which way she looks: always toward the centre of the screen she is on
let until = 0; // when the current state times out
let pos = { x: 0, y: 0 };
let vel = { x: 0, y: 0 };
let applied = { x: null, y: null };
let firstDrop = true;
// Conversation tracking, so she never dozes off mid-line or right after one.
const TALK_TIMEOUT = 60000; // safety net if the renderer never reports the end of a line
const QUIET_BEFORE_SLEEP = Number(process.env.PET_QUIET_MS) || 45000; // how long things must be calm before she may nap
let talkingSince = 0; // when the current line started (0 = not speaking)
let lastActivity = Date.now(); // last time she spoke or was clicked, carried or dropped
// Idle chatter is spaced out: after any line ends, she says nothing unprompted for a while.
const CHATTER_GAP = (process.env.PET_CHATTER_MS || '80000,160000').split(',').map(Number); // min,max ms
const chatterGap = () => CHATTER_GAP[0] + Math.random() * (CHATTER_GAP[1] - CHATTER_GAP[0]);
let nextChatter = Date.now() + chatterGap();
const isTalking = () => talkingSince > 0 && Date.now() - talkingSince < TALK_TIMEOUT;
const inConversation = () => isTalking() || Date.now() - lastActivity < QUIET_BEFORE_SLEEP;
let floating = false; // placed somewhere above the floor and staying there (gravity off)
let press = null; // { start, off, dragging } while the mouse button is held on the pet
let sprite = { w: 152, h: 152 };
// Transparent room around the sprite so no animation is clipped by the window: `side` for
// tilting and tumbling, `foot` for the corner that dips below her feet when she leans.
let room = { side: 60, foot: 20 };

const rand = (a, b) => a + Math.random() * (b - a);

function loadSettings() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try {
    Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile, 'utf8')));
  } catch {}
  // for trying an outfit without touching saved settings
  if (process.env.PET_CHAR) settings.character = process.env.PET_CHAR;
  if (process.env.PET_SKIN) settings.skin = process.env.PET_SKIN;
  if (process.env.PET_POSE) settings.pose = process.env.PET_POSE;
  if (process.env.PET_ANCHOR) {
    const [x, y] = process.env.PET_ANCHOR.split(',').map(Number);
    settings.anchor = { x, y };
    settings.gravity = false;
  }
  if (!CHARACTERS[settings.character]) settings.character = 'bismarck';
  if (!CHARACTERS[settings.character].skins[settings.skin]) settings.skin = 'main';
  if (!POSES[settings.pose]) settings.pose = 'chibi';
  delete settings.form;
  if (!SIZES.some((s) => s.value === settings.scale)) settings.scale = 1;
}

// A run started with test overrides (PET_SKIN, PET_DEMO, ...) must never write them into the
// saved settings, even if the pet is dragged or a menu item is used while it is up.
const TEST_RUN = Object.keys(process.env).some((k) => /^PET_(CHAR|SKIN|POSE|ANCHOR|X|DEMO|SHOT|SLEEPY)/.test(k));

function saveSettings() {
  if (TEST_RUN) return;
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  } catch {}
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send('pet:' + channel, data);
}

const DEBUG = !!process.env.PET_DEBUG;
const T0 = Date.now();
const trace = (...a) => DEBUG && console.log(((Date.now() - T0) / 1000).toFixed(2), ...a);

function emit(kind) {
  trace('emit', kind);
  send('event', kind);
}

function setState(next, ms) {
  trace('state', next, 'y', Math.round(pos.y), 'vy', vel.y.toFixed(1));
  state = next;
  until = ms ? Date.now() + ms : 0;
  send('state', { state, dir, face, floating });
}

function winSize() {
  return { w: Math.max(sprite.w + room.side * 2, MIN_WIDTH), h: sprite.h + BUBBLE_SPACE + room.foot };
}

// Where the pet may stand: the work area (above the Dock / taskbar) of whichever display it is on.
// The whole window (sprite, speech bubble and animation room) is kept inside the work area, so
// nothing is ever cut off by a screen edge or hidden behind the Dock. While she is being
// carried, the display under the cursor decides, so she can still be moved between screens.
function bounds(point) {
  const { w, h } = winSize();
  const display = screen.getDisplayNearestPoint(
    point || { x: Math.round(pos.x + w / 2), y: Math.round(pos.y + h / 2) },
  );
  const wa = display.workArea;
  return {
    minX: wa.x,
    maxX: wa.x + wa.width - w,
    minY: wa.y,
    floor: wa.y + wa.height - h,
    centerX: wa.x + wa.width / 2,
  };
}

// She looks toward the middle of the screen. The dead zone stops her flipping back and forth
// when she is standing right on the centre line.
function updateFace(b) {
  const x = pos.x + winSize().w / 2;
  const next = x < b.centerX - 30 ? 1 : x > b.centerX + 30 ? -1 : face;
  if (next === face) return;
  face = next;
  send('state', { state, dir, face, floating });
}

// Her spot is stored as the point under her feet, so it survives outfit and size changes.
function saveAnchor() {
  const { w, h } = winSize();
  settings.anchor = settings.gravity ? null : { x: Math.round(pos.x + w / 2), y: Math.round(pos.y + h) };
  saveSettings();
}

// Puts her back on her saved spot (clamped to whatever screen it is on now). Returns false if there is none.
function restoreAnchor() {
  const a = settings.anchor;
  if (settings.gravity || !a || typeof a.x !== 'number' || typeof a.y !== 'number') return false;
  const { w, h } = winSize();
  const b = bounds({ x: a.x, y: a.y });
  pos.x = Math.min(Math.max(a.x - w / 2, b.minX), b.maxX);
  pos.y = Math.min(Math.max(a.y - h, b.minY), b.floor);
  floating = pos.y < b.floor - 2;
  return true;
}

function applyPos() {
  const x = Math.round(pos.x);
  const y = Math.round(pos.y);
  if (x === applied.x && y === applied.y) return;
  applied = { x, y };
  win.setPosition(x, y, false);
}

function applyForm(keepAnchor) {
  const form = currentForm();
  const k = form.base * settings.scale;
  const old = winSize();
  sprite = { w: Math.round(form.w * k), h: Math.round(form.h * k) };
  // leaning up to ~10 degrees about her feet swings her head sideways and dips a lower corner;
  // the chibi also somersaults, which needs half its diagonal
  const lean = Math.sin((10 * Math.PI) / 180);
  const tumble = settings.pose === 'chibi' ? Math.hypot(sprite.w, sprite.h) / 2 - sprite.w / 2 : 0;
  room = {
    side: Math.ceil(Math.max(sprite.h * lean, tumble)) + 8,
    foot: Math.ceil((sprite.w / 2) * lean) + 6,
  };
  const size = winSize();

  if (keepAnchor) {
    // keep the feet where they were
    pos.x += (old.w - size.w) / 2;
    pos.y += old.h - size.h;
  }
  win.setBounds({ x: Math.round(pos.x), y: Math.round(pos.y), width: size.w, height: size.h });
  applied = { x: Math.round(pos.x), y: Math.round(pos.y) };

  const data = fs.readFileSync(path.join(ASSETS, formKey(), 'neutral.png')).toString('base64');
  send('config', {
    form: formKey(),
    src: `data:image/png;base64,${data}`,
    w: sprite.w,
    h: sprite.h,
    faces: form.faces,
    foot: room.foot,
    card: !!form.card,
    quiet: settings.quiet,
    voice: settings.voice,
    lines: loadVoiced(),
    moods: loadMoods(),
    rotate: Number(process.env.PET_ROTATE_MS) || 60000, // full figure: time in each pose
  });
  send('state', { state, dir, face, floating });
}

// Which moment each folder in resources/scripts is spoken at, by folder-name prefix.
// First match wins; anything unmatched becomes idle chatter.
const SCRIPT_CATEGORIES = [
  [/^(login|hi)/i, 'greet'], // on launch, or when she is switched to
  [/^touch_?head/i, 'pat'], // clicked on the head
  [/^spec/i, 'pokeMany'], // clicked 4+ times in a row
  [/^touch/i, 'poke'], // clicked on the body
  [/^victory/i, 'land'], // landed after being thrown
];

// resources/scripts/<name>/ holds text.txt (the line) and optionally one audio file (her voice).
function loadVoiced() {
  const out = {};
  let dirs = [];
  try {
    dirs = fs.readdirSync(scriptsDir(), { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return out;
  }
  for (const d of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(scriptsDir(), d.name);
    let text = '';
    try {
      text = fs.readFileSync(path.join(dir, 'text.txt'), 'utf8').replace(/^﻿/, '').trim();
    } catch {}
    const audio = fs.readdirSync(dir).find((f) => /\.(mp3|ogg|wav|m4a)$/i.test(f));
    // A folder without text would be a voice with no dialogue on screen, so it is not used.
    if (!text) {
      if (audio) console.log('script folder skipped (audio but empty text.txt):', d.name);
      continue;
    }
    const match = SCRIPT_CATEGORIES.find(([re]) => re.test(d.name));
    const category = match ? match[1] : 'talk';
    (out[category] = out[category] || []).push({
      text,
      audio: audio ? pathToFileURL(path.join(dir, audio)).href : null,
    });
  }
  return out;
}

// Expression frames for the current sprite: every <mood>.png beside its neutral.png. The
// renderer swaps to them by mood.
function loadMoods() {
  const moods = {};
  const dir = path.join(ASSETS, formKey());
  for (const name of MANIFEST[formKey()].moods || []) {
    try {
      moods[name] = 'data:image/png;base64,' + fs.readFileSync(path.join(dir, name + '.png')).toString('base64');
    } catch {}
  }
  return moods;
}

function pickNext() {
  const hour = new Date().getHours();
  const night = hour >= 23 || hour < 6;
  const r = Math.random();

  const forceNap = !!process.env.PET_SLEEPY; // test hook: she wants to nap at every opportunity
  if ((forceNap || r < (night ? 0.3 : 0.08)) && !inConversation()) {
    emit('sleep');
    setState('sleep', rand(25000, 70000));
    return;
  }
  if (forceNap) {
    setState('idle', 1000); // ask again in a second
    return;
  }
  if (!settings.stay && !floating && r < 0.65) {
    const b = bounds();
    if (pos.x <= b.minX + 40) dir = 1;
    else if (pos.x >= b.maxX - 40) dir = -1;
    else dir = Math.random() < 0.5 ? -1 : 1;
    setState('walk', rand(2000, 6500));
    return;
  }
  if (r < 0.85 && !settings.quiet && !isTalking() && Date.now() >= nextChatter) {
    nextChatter = Date.now() + chatterGap();
    emit('talk');
  }
  setState('idle', rand(4000, 9000));
}

function tick() {
  if (!win || win.isDestroyed()) return;
  const now = Date.now();
  const b = bounds();

  if (press) {
    const cur = screen.getCursorScreenPoint();
    if (!press.dragging && Math.hypot(cur.x - press.start.x, cur.y - press.start.y) > 4) {
      press.dragging = true;
      vel = { x: 0, y: 0 };
      emit('drag');
      setState('drag');
    }
    if (press.dragging) {
      const nx = cur.x - press.off.x;
      const ny = cur.y - press.off.y;
      vel.x = vel.x * 0.6 + (nx - pos.x) * 0.4;
      vel.y = vel.y * 0.6 + (ny - pos.y) * 0.4;
      const db = bounds(cur);
      pos.x = Math.min(Math.max(nx, db.minX), db.maxX);
      pos.y = Math.min(Math.max(ny, db.minY), db.floor);
    }
  } else if (state === 'fall') {
    vel.y += GRAVITY;
    vel.x *= 0.99;
    pos.x += vel.x;
    pos.y += vel.y;
    if (pos.x < b.minX) {
      pos.x = b.minX;
      vel.x = Math.abs(vel.x) * 0.5;
    } else if (pos.x > b.maxX) {
      pos.x = b.maxX;
      vel.x = -Math.abs(vel.x) * 0.5;
    }
    if (pos.y >= b.floor) {
      pos.y = b.floor;
      if (vel.y > 7) {
        vel.y = -vel.y * 0.3;
        vel.x *= 0.6;
        emit('bounce');
      } else {
        vel = { x: 0, y: 0 };
        // the drop-in at launch lands silently, so it does not talk over the greeting
        emit(firstDrop ? 'bounce' : 'land');
        firstDrop = false;
        setState('idle', rand(3000, 6000));
      }
    }
  } else {
    // the floor can move under her (Dock resize, display change): drop or snap back onto it
    if (floating) {
      // staying where she was put: only keep her on screen
      pos.x = Math.min(Math.max(pos.x, b.minX), b.maxX);
      pos.y = Math.min(Math.max(pos.y, b.minY), b.floor);
      if (pos.y >= b.floor - 2) {
        floating = false;
        send('state', { state, dir, face, floating });
      }
    } else if (pos.y < b.floor - 2) {
      vel = { x: 0, y: 0 };
      setState('fall');
    } else {
      pos.y = b.floor;
      pos.x = Math.min(Math.max(pos.x, b.minX), b.maxX);
    }

    if (state === 'walk') {
      pos.x += dir * currentForm().speed * Math.max(settings.scale, 0.8);
      if (pos.x <= b.minX || pos.x >= b.maxX) {
        pos.x = Math.min(Math.max(pos.x, b.minX), b.maxX);
        dir = -dir;
        send('state', { state, dir, face, floating });
      }
    }

    if (until && now >= until) {
      if (state === 'sleep') {
        emit('wake');
        setState('idle', rand(3000, 6000));
      } else if (state !== 'fall') {
        pickNext();
      }
    }
  }

  updateFace(b);
  applyPos();
}

function poke() {
  lastActivity = Date.now();
  if (state === 'sleep') {
    emit('wake');
    setState('idle', rand(3000, 6000));
    return;
  }
  emit('poke');
  setState('react', 1200); // long enough for the longest click animation to finish before she walks off
}

function buildMenu() {
  const refresh = () => {
    saveSettings();
  };
  return Menu.buildFromTemplate([
    { label: 'Talk', click: () => (state === 'sleep' ? poke() : emit('talk')) },
    state === 'sleep'
      ? { label: 'Wake up', click: () => poke() }
      : {
          label: 'Take a nap',
          click: () => {
            emit('sleep');
            setState('sleep', rand(60000, 180000));
          },
        },
    { type: 'separator' },
    {
      label: 'Character',
      submenu: Object.entries(CHARACTERS).map(([key, c]) => ({
        label: c.label,
        type: 'radio',
        checked: settings.character === key,
        click: () => {
          if (settings.character === key) return;
          settings.character = key;
          if (!c.skins[settings.skin]) settings.skin = 'main'; // she may not have the outfit the other one wore
          applyForm(true);
          refresh();
          emit('greet'); // the newcomer says hello
        },
      })),
    },
    {
      label: 'Outfit',
      submenu: Object.entries(CHARACTERS[settings.character].skins).map(([key, s]) => ({
        label: s.label,
        type: 'radio',
        checked: settings.skin === key,
        click: () => {
          settings.skin = key;
          applyForm(true);
          refresh();
        },
      })),
    },
    {
      label: 'Pose',
      submenu: Object.entries(POSES).map(([key, p]) => ({
        label: p.label,
        type: 'radio',
        checked: settings.pose === key,
        click: () => {
          settings.pose = key;
          applyForm(true);
          refresh();
        },
      })),
    },
    {
      label: 'Size',
      submenu: SIZES.map((s) => ({
        label: s.label,
        type: 'radio',
        checked: settings.scale === s.value,
        click: () => {
          settings.scale = s.value;
          applyForm(true);
          refresh();
        },
      })),
    },
    {
      label: 'Fall to the floor when released',
      type: 'checkbox',
      checked: settings.gravity,
      click: (item) => {
        settings.gravity = item.checked;
        if (settings.gravity) floating = false; // the main loop sees she is above the floor and drops her
        saveAnchor();
      },
    },
    {
      label: 'Stay in place',
      type: 'checkbox',
      checked: settings.stay,
      click: (item) => {
        settings.stay = item.checked;
        if (settings.stay && state === 'walk') setState('idle', rand(3000, 6000));
        refresh();
      },
    },
    {
      label: 'Quiet (no idle chatter)',
      type: 'checkbox',
      checked: settings.quiet,
      click: (item) => {
        settings.quiet = item.checked;
        refresh();
      },
    },
    {
      label: 'Voice',
      type: 'checkbox',
      checked: settings.voice,
      click: (item) => {
        settings.voice = item.checked;
        applyForm(true);
        refresh();
      },
    },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: settings.onTop,
      click: (item) => {
        settings.onTop = item.checked;
        win.setAlwaysOnTop(settings.onTop, 'floating');
        refresh();
      },
    },
    { type: 'separator' },
    { label: 'Reload script', click: () => applyForm(true) },
    { label: 'Gallery…', click: openGallery },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function openGallery() {
  if (galleryWin && !galleryWin.isDestroyed()) {
    galleryWin.show();
    galleryWin.focus();
    return;
  }
  galleryWin = new BrowserWindow({
    width: 1180,
    height: 640,
    title: 'Gallery',
    backgroundColor: '#14110f',
    autoHideMenuBar: true,
  });
  galleryWin.loadFile(path.join(__dirname, 'renderer', 'gallery.html'));
}

function createPet() {
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: MIN_WIDTH,
    height: 152 + BUBBLE_SPACE,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(settings.onTop, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // transparent pixels pass clicks through; the renderer turns this off while the cursor is on the sprite
  win.setIgnoreMouseEvents(true, { forward: true });

  pos = { x: wa.x + wa.width - MIN_WIDTH - 120, y: wa.y - 200 };
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.on('pet:ready', () => {
  applyForm(false);
  // drop in from above the screen
  const b = bounds();
  // test hook: PET_X=0..1 starts her that far across the screen (0 = left edge, 1 = right edge)
  if (process.env.PET_X) pos.x = b.minX + Number(process.env.PET_X) * (b.maxX - b.minX);
  pos.x = Math.min(Math.max(pos.x, b.minX), b.maxX);
  pos.y = Math.max(b.floor - 320, b.minY);
  vel = { x: 0, y: 0 };
  if (!process.env.PET_X && restoreAnchor()) {
    firstDrop = false;
    applyPos();
    win.showInactive();
    setState('idle', rand(3000, 6000));
  } else {
    win.showInactive();
    setState('fall');
  }
  setTimeout(() => emit('greet'), 1200);

  if (process.env.PET_SHOT) {
    win.webContents.on('console-message', (_e, _level, message) => console.log('renderer:', message));
    if (process.env.PET_DEMO) {
      const delay = Number(process.env.PET_SHOT_DELAY || 3000);
      setTimeout(() => send('demo', process.env.PET_DEMO), Number(process.env.PET_DEMO_AT || delay - 350));
    }
    setTimeout(async () => {
      const image = await win.webContents.capturePage();
      fs.writeFileSync(process.env.PET_SHOT, image.toPNG());
      console.log('shot', JSON.stringify({ state, face, bounds: win.getBounds(), workArea: screen.getDisplayMatching(win.getBounds()).workArea }));
    }, Number(process.env.PET_SHOT_DELAY || 3000));
  }
});

ipcMain.on('pet:ignore', (_e, ignore) => {
  if (!win || press) return;
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
});

ipcMain.on('pet:talking', (_e, on) => {
  trace('talking', on);
  talkingSince = on ? Date.now() : 0;
  lastActivity = Date.now();
  if (!on) nextChatter = Date.now() + chatterGap(); // the gap is measured from the end of the last line
});

ipcMain.on('pet:press', () => {
  lastActivity = Date.now();
  const cur = screen.getCursorScreenPoint();
  press = { start: cur, off: { x: cur.x - pos.x, y: cur.y - pos.y }, dragging: false };
});

ipcMain.on('pet:release', () => {
  lastActivity = Date.now();
  if (!press) return;
  const dragged = press.dragging;
  press = null;
  if (dragged && !settings.gravity) {
    // stay exactly where she was let go
    vel = { x: 0, y: 0 };
    floating = pos.y < bounds().floor - 2;
    saveAnchor();
    emit('land');
    setState('idle', rand(3000, 6000));
  } else if (dragged) {
    vel.x = Math.max(-40, Math.min(40, vel.x));
    vel.y = Math.max(-40, Math.min(40, vel.y));
    setState('fall');
  } else {
    poke();
  }
});

ipcMain.on('pet:menu', () => {
  buildMenu().popup({ window: win });
});

app.whenReady().then(() => {
  loadSettings();
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  createPet();

  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'tray.png')));
  tray.setToolTip('Desktop pet');
  const popTray = () => tray.popUpContextMenu(buildMenu());
  tray.on('click', popTray);
  tray.on('right-click', popTray);

  setInterval(tick, TICK_MS);
});

app.on('window-all-closed', () => app.quit());
