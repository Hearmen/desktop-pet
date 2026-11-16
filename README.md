# Desktop Pet

A small Electron desktop pet: a character who lives on your desktop, walks around, reacts when
you click or pat her, and speaks her lines with voice.

Two characters are included, **Bismarck** and **Cheshire**, each with several outfits and two
forms: a chibi and a full figure.

Built and tested on macOS only.

## Run it

Needs [Node.js](https://nodejs.org/).

```sh
npm install
npm start
```

She drops onto your desktop and greets you. There is no main window; quit from her menu or the
tray icon.

## What she does

| You do | She does |
|---|---|
| Click her body | Reacts with an expression or pose and says a line |
| Click her head | Takes it as a pat |
| Click many times in a row | Gets annoyed |
| Drag her | Dangles from the cursor, then stays where you put her |
| Leave her alone | Wanders, fidgets, chats now and then, and eventually dozes off |
| Right-click her | Opens the menu |

She always faces the centre of the screen, and never falls asleep in the middle of a
conversation.

## Menu

- **Talk**, **Take a nap / Wake up**
- **Character**, **Outfit**, **Pose** (chibi or full figure), **Size**
- **Fall to the floor when released**: off by default, so she stays where you drop her
- **Stay in place**: stops her wandering
- **Quiet**: no idle chatter
- **Voice**: text bubbles only when off
- **Always on top**
- **Reload script**: picks up edited lines without restarting
- **Gallery…**: the source illustrations

Settings are remembered between launches.

## Adding lines

Lines are read at launch from `resources/<Character>/scripts/`. Nothing is built in: she only
says what is in that folder.

Each line is a folder holding a `text.txt` and, optionally, one audio file (mp3, ogg, wav or
m4a). The folder name decides when the line is used:

| Folder name starts with | Used when |
|---|---|
| `login`, `hi` | She greets you at launch |
| `touch_head` | You pat her head |
| `touch` | You click her |
| `spec` | You click her too many times |
| `victory` | She lands after being dropped |
| anything else | Idle chatter |

A folder with an empty `text.txt` is skipped.

## Project layout

```
main.js            window, movement, menu, script loading
preload.js         bridge between the two processes
renderer/          drawing, animations, speech bubble, click handling
assets/            the cut-out frames the app shows, plus manifest.json listing them
resources/         source illustrations, pose sheets, lines and voice clips
```

The frames in `assets/` are cut from the sheets in `resources/` ahead of time. Replacing a sheet
does not change the pet until its frames are cut again and `assets/manifest.json` is updated.

## Credits

The characters, illustrations and voice clips come from *Azur Lane* and belong to their
respective owners. This is a non-commercial fan project and is not affiliated with or endorsed
by the game's publishers.
