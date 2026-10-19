<!-- markdownlint-disable MD037 MD022 MD032 MD024 -->

# CHANGELOG

## [Unreleased]
### Changed
- Renamed to Local Theatre, with a new app ID (installs alongside Vic Theatre)
- Theatres are now plugins, run by the background runner: the Vic, and Cinecenta (off by default; turn it on in Settings → Theatres)
- A theatre whose site fails keeps showing its last schedule
- Settings → Theatres: turn each theatre on or off
- Settings → Theatres: an (i) per theatre with who runs it, where its data comes from, the plugin's author and version, and its last run
- With more than one theatre: a coloured tag on each film and showing, and a theatre menu on Films and By day
- Wide or tall posters are shown whole, over a blurred fill
- Placeholder "LT" icon instead of the Vic's emblem; header says Local Theatre
- Violet accent colour (the Vic's magenta is now its tag colour)
- The About disclaimer lists each theatre
- A film on at several theatres is shown once, with each theatre's showtimes tagged (Settings → Combine films to turn off)
- Posters and banner stills from The Movie Database with your own TMDB key (Settings → TMDB key); a theatre can use its own images instead
- Films page uses poster-shaped (2:3) tiles
- Fix on a film's page: pick the right TMDB film when the poster match is wrong
- Tap "Updated …" in the header to see an update as it happens: each theatre's current step, progress and time
- Scan the TMDB key from a QR code (`npm run key-qr` shows one on the computer)
- Background check rate is now a setting: every 1, 3, 6, 12 or 24 hours, or never (default 3 hours)

## [1.0.2] - 2026-10-16
### Added
- Info button explaining how the schedule refreshes
- "Updated … ago" now updates live

### Changed
- New film checks run every 4 hours (was 6)
- Back on Saved or By day goes to Films

### Fixed
- Android back button closing the app instead of going back

## [1.0.1] - 2026-10-16
### Added
- Changelog to the about page
- Add 1 hour minimum for auto refresh

## [1.0.0] - 2026-10-16
### Added
- Initial app release
