# TODO / deprecated

## Wave (deprecated, hidden from the UI)

An endless "personal radio" in the spirit of Yandex Music's *My Wave*. The code
lives in `src/renderer/overlays/wave.ts` but the panel is **not registered**
(`src/main/main.ts`), so it cannot be opened from the app.

### What exists
- Candidate pool from SoundCloud's own recommenders: track stations
  (`/stations/soundcloud:track-stations:{id}/tracks`), `/tracks/{id}/related`,
  mood searches and charts for a cold start; stub tracks are hydrated through
  `/tracks?ids=`.
- Local taste profile (artist/tag weights, learned from like / dislike /
  skip / finished), ranking with variety rules (no same artist back to back),
  language filter (Cyrillic detection), "familiar <-> new" slider.
- 3D logo UI, like/dislike/skip, heart animation.
- **Queue injection**: `src/preload/api-tap.ts` can answer SoundCloud's
  `/tracks/{id}/related` XHR with our own list through
  `window.__scRelatedOverride(trackId, data, url)`. SoundCloud's autoplay
  follows that list, so no page navigation is needed after the first track.
  The hook is inert while nothing defines `__scRelatedOverride`.

### Why it was shelved
- Playback start relied on opening the track page and pressing its big play
  button; slugs/redirects and layout differences made this unreliable.
- Re-ranking after a like only affects what has not been handed to
  SoundCloud yet (the player pulls the related list page by page).
- Not verified end to end on a signed-in account (anonymous sessions only get
  previews and hit the sign-in modal); the "Next up" panel was empty in the
  anonymous test.
- Ideas: grab SoundCloud's internal play-queue module (webpack runtime) and
  insert items directly; or build a real playlist and play that; check what
  the logged-in related request looks like (`variant`, `query_urn`).

## Other
- Last.fm scrobbling (needs a registered API key); only ListenBrainz exists.
- Loudness normalisation: SoundCloud owns the Web Audio graph and rebuilds it
  per track, a compressor cannot be inserted reliably.
- Hiding reposts in the feed (needs the signed-in feed DOM).
