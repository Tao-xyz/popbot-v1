# assets/

This folder is **not populated with real Popdex brand assets** — those are
yours (logo, licensed fonts, and the premium animated templates), and I
can't fabricate them for you. The bot's rendering code (`src/cards/`)
already looks for exactly these files, at exactly these paths, so once you
drop the real files in, every card starts using them automatically — no
code changes required.

```
assets/
├── logo.png            ← Official Popdex logo. Rendered LARGE (own row,
│                          ~50–58px tall) at the top of every card, never
│                          cropped or masked into a tiny square — no extra
│                          "Popdex" wordmark is drawn beside it.
├── news.png             ← Background art for /news cards
├── market.png            ← Background art for /market, /volume, /oi, /pulse
├── vault.png             ← Background art for /tvl cards
├── position_1.png         ← Static Position Card design 1 (right-side art)
├── position_2.png         ← Static Position Card design 2 (right-side art)
├── position_3.mp4          ← Animated Position Card design 1 (template —
│                              see below)
├── position_4.mp4          ← Animated Position Card design 2 (template)
└── fonts/
    ├── Arial.ttf            ← Regular weight
    └── Arial-Bold.ttf        ← Bold weight
```

## Fallback behavior (so the bot still runs without these)

- **Missing background PNG** (`market.png`, `news.png`, `vault.png`,
  `position_1.png`, `position_2.png`): the card falls back to a dark
  gradient background instead of failing.
- **Missing `logo.png`**: the logo is simply skipped (no crash).
- **Missing fonts**: falls back to the system sans-serif so text still
  renders, with a console warning telling you which font file is missing.
- **Missing `position_3.mp4` / `position_4.mp4`**: the animated card
  option fails with a clear in-Discord error telling the user (and you, in
  the logs) exactly which file is missing — there's no synthetic fallback
  here, because there's no static-card equivalent that captures "premium
  animated template" without the actual template.

## Position Card layout — 60% data / 40% artwork

Both the static (`position_1.png` / `position_2.png`) and animated
(`position_3.mp4` / `position_4.mp4`) Position Cards use the same split:

- **Left 60%** is a dark, fully-opaque data panel — logo, symbol, side,
  PnL %, entry/mark/liquidation price, leverage, referral code. This zone
  is always fully populated, never left blank.
- **Right 40%** shows your template artwork clean and unobstructed — no
  text is ever placed there. The panel edge fades (rather than hard-cuts)
  a little past the 60% line so it blends into the art instead of looking
  like a pasted rectangle.

Design your `position_1.png` / `position_2.png` / `position_3.mp4` /
`position_4.mp4` artwork with this in mind: put the character/graphic
focal point in the **right 40%** of the frame, and keep the left 60%
relatively simple (it'll be covered by the dark data panel/scrim anyway,
so fine detail there won't be visible).

## About the animated position cards (`position_3.mp4` / `position_4.mp4`)

These are **template videos** — short, loopable MP4 clips with your subtle
glow / particle / light-movement animation. The bot does **not** generate
this animation; it only overlays the live position data on top of your
template using `ffmpeg drawtext` (plus a light readability scrim over the
left 60%, matching the static card), via
`src/cards/animatedPositionCard.js`.

**Minimum output length: 5 seconds.** If your template clip is shorter
than that, the bot automatically loops it (via `ffmpeg -stream_loop`) and
trims the result to exactly 5 seconds — you'll never get a jarringly short
1-second clip regardless of how short the source template loop is.
Templates that are already 5 seconds or longer are left at their natural
length, untouched. Output has no audio track (`-an`) to avoid loop/sync
artifacts — these are meant to be silent, ambient card animations.

Practical guidance for the templates themselves:
- A loop length of **3–6 seconds** is ideal — long enough to read as a
  proper animation, short enough that the loop point isn't awkward once
  it's stitched to reach the 5s floor.
- Text overlay coordinates in `renderAnimatedPositionCard()` are tuned
  assuming a landscape template in roughly the same proportions as the
  static Position Card (~780×460). If your actual template resolution or
  aspect ratio differs meaningfully, adjust the `y` values (and the
  `LEFT_X` / scrim width if needed) in that file — x-positioning already
  uses width-relative expressions (`w*0.055`, etc.) so it holds up across
  different resolutions; only the pixel-based `y` offsets and font sizes
  are resolution-sensitive.
- `fontfile` for the overlay is `assets/fonts/Arial-Bold.ttf` (+ regular
  for secondary text) — same font family as every other card.

## Logo integration details

`drawLogo()` in `src/cards/canvasUtils.js` draws `logo.png` at a generous,
prominent size (`height` in px, default 64 — most cards call it with
50–58), preserving its real aspect ratio with **no cropping mask**. It
gets its own dedicated row at the top of every card — nothing else shares
that baseline — rather than being squeezed in next to header text. If
your logo file has a lot of internal padding/whitespace, trim it so it
reads clearly at that size.
