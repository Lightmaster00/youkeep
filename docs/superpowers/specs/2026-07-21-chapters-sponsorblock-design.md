# Video Chapters & Sponsor Segment Handling — Design

## Context

This is the first sub-project out of the downloader feature wishlist (see project memory `project_downloader_feature_wishlist`). It covers two related capabilities that both build on `yt-dlp`'s existing metadata pipeline:

1. **Chapters**: YouTube videos often have chapters (timestamps in the description, exposed by YouTube's own metadata). `yt-dlp`'s `--write-info-json` (already used by this project — `server/utils/downloader.ts:649`) captures them in a `chapters` array, but nothing today parses or stores that data — the info JSON is read for description/views/upload date/likes/comments, then deleted to save disk space (`server/utils/downloader.ts:804-850`).
2. **Sponsor segment handling**: `yt-dlp` integrates with the community SponsorBlock database (segments submitted per-video, keyed by category: sponsor, intro, outro, self-promo, interaction/like-reminders, filler) via `--sponsorblock-remove` (cut the segment out, re-encoding via ffmpeg) and `--sponsorblock-mark` (leave the segment in, but expose it as a chapter). Coverage depends on community submissions — it's strong for popular content and can be empty for small/niche channels, so this must never be an all-or-nothing forced behavior.

Both land in the same place technically: `yt-dlp` produces a `chapters` array either way (native YouTube chapters, or SponsorBlock-marked segments, or both), and the video player needs to show it. Building them together avoids parsing/storing/rendering the same shape of data twice.

## Scope

- **New downloads only.** `yt-dlp` deletes its `.info.json` file after processing today, specifically to save disk space — videos already in the archive have no chapter data left on disk to recover it from. Retroactively backfilling would mean a metadata-only re-fetch (`yt-dlp --dump-json`, no video re-download) against YouTube for every existing video, which is real added work and added external traffic proportional to archive size — explicitly decided against for this pass. Existing videos simply have no chapters until they're re-downloaded (e.g. via a future "resync channel" action, out of scope here).
- **Per-category SponsorBlock behavior is a single global setting**, not per-channel or per-user. The cut happens once, at download time, into the shared file every user of the instance watches — it can't be a per-viewer preference the way, say, a subtitle language selection can.

## Non-Goals

- No backfill of chapters/SponsorBlock data onto already-downloaded videos.
- No live/in-progress-stream capture concerns — this only touches the existing on-demand video download path.
- No change to comment extraction or any other existing use of the info JSON — chapters parsing is added alongside it, not a replacement.
- No per-channel or per-user override of the SponsorBlock settings — one global configuration for the whole instance.

## Design

### 1. Data model

A new table, `video_chapters`:

```sql
CREATE TABLE video_chapters (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  start_time REAL NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('youtube', 'sponsorblock')),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);
```

`source` distinguishes a chapter YouTube itself provided from one that exists only because a SponsorBlock category was set to "Mark" — this is what lets the player style them differently (Design section 4) without re-deriving the distinction from the title text.

### 2. Download-time parsing

In `server/utils/downloader.ts`, at the existing info-JSON read (`:804-850`, where `desc`/`views`/`uploadDate`/`likeCount`/comments are already parsed from the same `infoData` object before the file is deleted), add parsing of `infoData.chapters`: a `yt-dlp` chapters entry has `{ start_time, end_time, title }`. Each becomes one `video_chapters` row with `start_time` taken directly, `title` taken directly, and `source` set to `'sponsorblock'` if the title matches the `[SponsorBlock]:` prefix pattern `yt-dlp` uses for SponsorBlock-sourced entries (exact prefix/format to be confirmed empirically against a real `--sponsorblock-mark` download during implementation — `yt-dlp`'s chapter-naming convention for these isn't being asserted as fact here, since it hasn't been verified against a live download yet), else `'youtube'`.

### 3. SponsorBlock category settings

Six categories, each with one of three states — **Ignore** (today's behavior, nothing happens), **Mark** (kept in the video, exposed as a `'sponsorblock'`-sourced chapter), **Remove** (cut out of the file via `yt-dlp`'s `--sponsorblock-remove`, re-encoded) — stored as individual rows in the existing global `settings` key-value table (already used for `downloader_paused`), one key per category:

```
sponsorblock_sponsor, sponsorblock_intro, sponsorblock_outro,
sponsorblock_selfpromo, sponsorblock_interaction, sponsorblock_filler
```

Each value is the literal string `ignore` / `mark` / `remove`. All default to `ignore` — no behavior changes for any existing instance until an admin explicitly opts a category in. At download time, the categories set to `mark` are collected into one `--sponsorblock-mark CATS` argument and the categories set to `remove` into one `--sponsorblock-remove CATS` argument (both omitted entirely if their category list is empty), added to the existing `yt-dlp` invocation in `downloadVideoFile` (`server/utils/downloader.ts:629-651`).

### 4. Settings UI

A new panel in `app/pages/settings.vue` (admin-only, alongside the existing downloader settings), listing the six categories with a 3-way choice each (Ignore / Mark / Remove). Saves directly to the `settings` table via a small new API endpoint pair (get/set), following the existing pattern for `downloader_paused`.

### 5. Player UI

`app/components/VideoPlayer.vue`'s scrubber (`.progress-bar-container`, `:57-75`) gains chapter markers: one absolutely-positioned tick per `video_chapters` row, positioned by `start_time / duration`. `source: 'youtube'` markers use the existing accent styling (matching the player's established violet/pink identity); `source: 'sponsorblock'` markers use a distinct muted red/orange tint, so a viewer can tell "this next segment is sponsored content" apart from a genuine chapter break at a glance. Hovering a marker (or scrubbing near it) shows its title in the player's existing progress-tooltip element (`.progress-tooltip`) — no new tooltip mechanism.

## Verification

- New-download chapters: download a video from a channel/video known to have real YouTube chapters, confirm `video_chapters` rows appear with `source = 'youtube'` and correct start times, confirm the player renders them.
- SponsorBlock mark: set one category (e.g. `sponsor`) to `mark`, download a video from a channel with known SponsorBlock coverage, confirm a `source = 'sponsorblock'` row appears and renders with the distinct color.
- SponsorBlock remove: set a category to `remove`, download a video, confirm the resulting file's duration is shorter by roughly the segment length and no chapter row was created for a removed segment (removal cuts it, it never becomes a chapter).
- Default/untouched instance: confirm a fresh install with no settings changes downloads exactly as it does today (no `--sponsorblock-*` flags sent at all when every category is `ignore`).
- Existing (pre-this-feature) videos: confirm they simply have zero `video_chapters` rows and the player shows no markers for them, without erroring.
