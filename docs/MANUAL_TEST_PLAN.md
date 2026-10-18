# Acceptance test plan — YouKeep

This document is an acceptance test plan: it checks, from the user interface only (no technical access to the server, the files or the database), that YouKeep's user journeys work as expected. It covers two profiles: the **standard user** and the **administrator** (in a self-hosted deployment the admin is often the end user as well).

## How to use this document

For each test case: follow the steps, compare with the expected result, tick ✅ (passes) or ❌ (fails, describe it under "Notes"), and write down the date and the tester.

**Before you start:**
- [ ] Use a test environment if possible (not real production data)
- [ ] Have one admin account and one standard user account
- [ ] Have at least 2 channels with downloaded content to test the browsing journeys

---

## Part A — Standard user

### A1. Sign-in and account

| # | Scenario | Steps | Expected result | ✅/❌ | Notes |
|---|---|---|---|---|---|
| A1.1 | Successful sign-in | Enter a valid username and password on the sign-in page | Signed in, taken to the home page | | |
| A1.2 | Refused sign-in | Enter a wrong password | Clear error message, not signed in | | |
| A1.3 | Mandatory password change | Sign in with an account the admin just created (temporary password) | The app requires a new password before anything else | | |
| A1.4 | Sign-out | Click "Log out" | Back to the sign-in screen; protected pages can no longer be opened | | |
| A1.5 | Edit your profile | Open "Account", change first/last name, email, phone, save | The details are saved and still there after reloading the page | | |
| A1.6 | Change your password | From "Account", enter the current password then a new one, confirm | Success message; signing in again works with the new password only | | |
| A1.7 | Too-short password refused | Try to set a new password shorter than 8 characters | Error message, change refused | | |

### A2. Discovery and browsing

| # | Scenario | Steps | Expected result | ✅/❌ | Notes |
|---|---|---|---|---|---|
| A2.1 | Home page | Sign in and look at the home page | A feed of videos is shown, with thumbnails, titles and channel names | | |
| A2.2 | Browse channels | Open the "Channels" tab | The list of available channels is shown correctly (avatar, description) | | |
| A2.3 | Open a channel | Click a channel | The channel page shows its videos and playlists | | |
| A2.4 | Search content | Use the search bar with a word found in a video title | Relevant results are shown quickly | | |
| A2.5 | Follow a channel | On a channel page, click "Subscribe" | The channel then appears in the "Subscriptions" tab | | |
| A2.6 | Unfollow | Click "Unsubscribe" on a followed channel | The channel disappears from the "Subscriptions" tab | | |
| A2.7 | Filter by subscriptions | On the home page, filter to see only content from followed channels | Only videos from followed channels are shown | | |

### A3. Watching

| # | Scenario | Steps | Expected result | ✅/❌ | Notes |
|---|---|---|---|---|---|
| A3.1 | Play a video | Click a video on the home page or a channel | The video loads and plays without errors | | |
| A3.2 | Seek in the video | Move the progress bar forwards/backwards | Playback resumes at once at the new position, without stalling | | |
| A3.3 | Watch history | Watch a video for a few seconds, come back to its page later | The video shows as watched / resuming is offered | | |
| A3.4 | Hide a video | From a video's menu, choose "Hide" | The video no longer appears in this account's recommendations | | |
| A3.5 | Report a video | Use "Report" and give a reason | Confirmation that the report was sent | | |
| A3.6 | Subtitles | If a video has subtitles, turn them on | Subtitles are shown in the chosen language | | |
| A3.7 | Shorts view | Open the "Shorts" tab and scroll | Smooth scrolling, each video shown plays automatically | | |

### A4. Personal playlists

| # | Scenario | Steps | Expected result | ✅/❌ | Notes |
|---|---|---|---|---|---|
| A4.1 | Create a playlist | From "Playlists", create a new playlist with a title | The playlist appears in the list | | |
| A4.2 | Add a video to a playlist | From a video's menu, add it to an existing playlist | The video appears in that playlist | | |
| A4.3 | Remove a video | From the playlist, remove a video | The video disappears from the playlist | | |
| A4.4 | Rename / edit a playlist | Change a playlist's title or description | The changes are saved | | |
| A4.5 | Delete a playlist | Delete a personal playlist | The playlist is permanently gone from the list | | |
| A4.6 | Share a playlist | Make a playlist public or "unlisted", copy its share link, open it in a private window | The playlist's content is visible through that link without signing in | | |
| A4.7 | Private playlist not reachable | Create a "private" playlist, try to open it with another account | Access refused | | |

### A5. Restricted content (visibility)

These cases check, from a user's point of view, that an access restriction set by the admin is actually enforced.

| # | Scenario | Steps | Expected result | ✅/❌ | Notes |
|---|---|---|---|---|---|
| A5.1 | Restricted content hidden without permission | With a standard account that has no particular permission, try to find a channel/video the admin marked as restricted (search, browsing, or a direct link the admin gave for the test) | The content appears in no list (home, search, playlists) and direct access is refused | | |
| A5.2 | Restricted content visible after permission | Ask the admin to grant this account access, then test again | The content becomes visible and plays normally | | |
| A5.3 | Share link to restricted content | Get a share link the admin generated for a restricted video, open it without signing in | The video is reachable only through that exact link | | |

---

## Part B — Administrator

### B1. First run

| # | Scenario | Steps | Expected result | ✅/❌ | Notes |
|---|---|---|---|---|---|
| B1.1 | Initial setup | Start the app for the very first time | A screen to create the administrator account is shown (not the usual sign-in screen) | | |
| B1.2 | Only one initial admin account | Once setup is done, reload the setup page | No admin account can be created this way again | | |

### B2. Channel management

| # | Scenario | Steps | Expected result | ✅/❌ | Notes |
|---|---|---|---|---|---|
| B2.1 | Add a channel | Search for a YouTube channel by name or link, add it | The channel appears in the list with its details (title, avatar) | | |
| B2.2 | Configure downloads | Choose to download videos / shorts / lives, set a start date | Only content matching these criteria is downloaded from then on | | |
| B2.3 | Sync a channel | Start a manual sync | New videos appear in the queue if there are any | | |
| B2.4 | Sync a channel's playlists | Start the playlists sync | The channel's playlists appear with their content | | |
| B2.5 | Pause a channel | Pause a channel | No new automatic sync while it is paused | | |
| B2.6 | Change a channel's visibility | Change a channel's visibility (public / private / ultra private) | What a user sees matches the new visibility (see A5) | | |
| B2.7 | Delete a channel | Delete a channel that has downloaded videos | The channel and its videos disappear from the app; the disk space it used is freed | | |

### B3. Downloader management

| # | Scenario | Steps | Expected result | ✅/❌ | Notes |
|---|---|---|---|---|---|
| B3.1 | Follow the queue | Open the downloader dashboard | Running/pending downloads are listed with their progress | | |
| B3.2 | Prioritise a download | Move a video to the top of the queue | It is processed before the others | | |
| B3.3 | Pause / resume | Pause the whole downloader, then resume it | No download starts while paused; downloads continue normally afterwards | | |
| B3.4 | Cancel a download | Cancel a running download | The download stops; the video goes back to pending or leaves the queue, depending on the action chosen | | |
| B3.5 | Retry a failure | Use "Retry" on a failed download | The download starts again | | |
| B3.6 | Clear the queue | Use the "Clear queue" action | Pending downloads are removed | | |
| B3.7 | Global sync | Start a sync of every active channel | The global sync status is shown and finishes without a visible error | | |
| B3.8 | Schedule an automatic sync | Turn on a scheduled sync at a given time | At that time a new sync starts on its own (check over a full cycle) | | |
| B3.9 | Read the logs | Open the logs page during an active download | The logs update live | | |
| B3.10 | Clean restart | Restart the app while a download runs, then check the queue again | No download stays stuck in "downloading" forever; it goes back to pending or failed | | |

### B4. User management

| # | Scenario | Steps | Expected result | ✅/❌ | Notes |
|---|---|---|---|---|---|
| B4.1 | Create a user | Create a new standard user account | The account works, with a temporary password to change at first sign-in | | |
| B4.2 | Change the role | Turn a standard user into an admin (and back) | Their rights change after signing in again | | |
| B4.3 | Grant access to a restricted channel | Give a user access to an "ultra private" channel | That user can now see the channel (see A5.2) | | |
| B4.4 | Reset a password | Reset a user's password | A new temporary password is generated and works for signing in | | |
| B4.5 | Delete a user | Delete a user account | The account can no longer sign in | | |
| B4.6 | Main admin account protected | Try to delete yourself or the last admin account | The action is blocked with a clear message | | |

### B5. Dashboard

| # | Scenario | Steps | Expected result | ✅/❌ | Notes |
|---|---|---|---|---|---|
| B5.1 | Global statistics | Open the statistics dashboard | The numbers shown (videos, channels, space used) look consistent with reality | | |

---

## Summary

| Part | Cases | ✅ Pass | ❌ Fail | Not tested |
|---|---|---|---|---|
| A1. Sign-in and account | 7 | | | |
| A2. Discovery and browsing | 7 | | | |
| A3. Watching | 7 | | | |
| A4. Personal playlists | 7 | | | |
| A5. Restricted content | 3 | | | |
| B1. First run | 2 | | | |
| B2. Channel management | 7 | | | |
| B3. Downloader management | 10 | | | |
| B4. User management | 6 | | | |
| B5. Dashboard | 1 | | | |
| **Total** | **57** | | | |

**Tester:** ______________  **Test campaign date:** ______________  **Version tested:** ______________
