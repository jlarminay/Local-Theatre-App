<!-- markdownlint-disable MD037 MD022 MD032 MD024 -->

# CHANGELOG

## [2.1.0] - 2026-10-18
### Added
- 2 new default theaters; Roxy, Capitol 6

## [2.0.0] - 2026-10-18
### Changed
- Renamed to Local Theatre
- Theatres are now plugins, run by the background runner.
- Added 2 default theaters: the Vic, and Cinecenta
- Violet is new accent colour
- The About disclaimer lists each theatre
- A film on at several theatres is shown once, with each theatre's showtimes tagged
- Updated Films page uses poster-shaped (2:3) tiles
- Add tool to fix TMDB matched movie
- Added TMDB api for posters
- Added QR code scanner for api key
- Background check rate is now a setting: every 1, 3, 6, 12 or 24 hours, or never (default 3 hours)
- Tap "Updated …" in the header to see an update as it happens: each theatre's current step, progress and time
- Updated single movie view with static header

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
