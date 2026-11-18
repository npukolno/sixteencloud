# TODO / deprecated

## Wave (shelved, removed from the main code)

An endless "personal radio" in the spirit of Yandex Music's *My Wave*. The
code was removed from the main line; the last full version lives on the
`archive/wave` branch: `src/renderer/overlays/wave.ts`, its i18n keys, the
`wave` store key and the `window.__scRelatedOverride` hook in
`src/preload/api-tap.ts`. Bring it back from there if the work resumes.

### What exists
- Candidate pool from SoundCloud's own recommenders: track stations
  (`/stations/soundcloud:track-stations:{id}/tracks`), `/tracks/{id}/related`,
  mood searches and charts for a cold start; stub tracks are hydrated through
  `/tracks?ids=`.
- Local taste profile (artist/tag weights, learned from like / dislike /
  skip / finished), ranking with variety rules (no same artist back to back),
  language filter (Cyrillic detection), "familiar <-> new" slider.
- 3D logo UI, like/dislike/skip, heart animation.
- **Queue injection** (archive branch): `src/preload/api-tap.ts` could answer SoundCloud's
  `/tracks/{id}/related` XHR with our own list through
  `window.__scRelatedOverride(trackId, data, url)`. SoundCloud's autoplay
  follows that list, so no page navigation is needed after the first track.

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
- Loudness: preamp + limiter / leveller run on a master bus that every
  connection to a destination is redirected into (preload/audio-hook.ts), so
  SoundCloud's per-track graph rebuild no longer drops them. Not verified yet
  on a session where SoundCloud plays without Web Audio (then there is no
  graph to hook and the EQ panel says it is waiting).
- Feed reposts (Player panel): detection and the "originals only" filter work
  on the /stream API response (preload/api-tap.ts). Folding uses the feed DOM
  (.soundList__item / a.soundTitle__title) and still needs a check on a
  signed-in feed.
