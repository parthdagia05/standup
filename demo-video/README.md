# Demo video renderer

Builds the Standup demo video without screen recording. A web page replays the real panel (`extension/media/panel.css` and `panel.js`, fed with scripted events) plus the explainer scenes, Playwright captures it frame by frame on a virtual clock, and ffmpeg adds a voice track.

The scenes are an illustrative replay, not a recording of a live run.

```bash
cd demo-video
npm install && npx playwright install chromium
brew install ffmpeg                         # if you don't have it
node build.mjs "path/to/voice.m4a" out/standup-demo.mp4
```

- `site/index.html`, `scenes.css`: the scenes. Anything with `data-at="<seconds>"` appears at that time on the video clock.
- `site/events.js`: the scripted run the replica panel plays.
- `site/captions.js`: captions, timed to the words of the voice track.
- `node shot.mjs 29 105` writes stills at those times to `out/`, for checking a scene without a full render.
- The timings were matched to one specific recording. For a different voice track, transcribe it with word timestamps and adjust the `data-at` values and caption times.

Set `CHROME=/path/to/chrome-headless-shell` to use a Chromium you already have.
