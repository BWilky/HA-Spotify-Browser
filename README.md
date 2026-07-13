# Spotify Browser Card

A Home Assistant Lovelace custom card that renders a full-screen Spotify browser interface.

> [!IMPORTANT]
> This card requires the custom [SpotifyPlus](https://github.com/thlucas1/homeassistantcomponent_spotifyplus) integration to function. SpotifyPlus **v1.0.200 or newer** is recommended for playlist management (create / edit / delete / add / remove / reorder) — older versions predate Spotify's February 2026 Web API migration fixes.

## Playlist management

The card mirrors the Spotify app's playlist experience:

* **Create** — "+" button on the Your Library page, or "New playlist" inside the add-to-playlist picker (name, description, public / collaborative).
* **Add to playlist** — every track's ⋯ menu (playlists, albums, Liked Songs, search results, Now Playing, the Queue) has *Add to Playlist*, listing your own playlists with an "already added" duplicate check.
* **Edit** — on playlists you own, the header ⋯ menu offers *Edit Details* (rename, description, visibility) and *Edit Tracks* (Spotify-style edit mode: drag handles to reorder, minus to remove, Save/Cancel). Track ⋯ menus also get a quick *Remove from this Playlist*.
* **Delete / follow** — deleting your own playlist (with confirmation) removes it from your library (Spotify semantics: unfollow); other people's playlists get *Add / Remove from Your Library* instead.

Notes: playlists now load fully (paged in the background) so large playlists are no longer truncated at 100 tracks; edits preserve each track's "date added" wherever Spotify's API allows (removing only *some* copies of a duplicated track requires a full rewrite, which resets it and is limited to playlists of ≤100 tracks). Cover image upload isn't supported — the SpotifyPlus service only accepts a file path on the HA host.

## Your Library

The Library page mirrors the Spotify app:

* **Buckets** — Playlists / Albums / Artists tabs, plus a default view that blends your recently played playlists, albums, and artists with your newest saves and follows.
* **Sorting** — each tab has its own Recents / A–Z toggle (the pill at the right end of the tab row); the choice is remembered per device and per tab.
* **Infinite scroll** — buckets page in as you scroll instead of truncating large collections.
* **Row menus** — every playlist/album row has a ⋯ menu: pin to Home, edit or delete playlists you own (edit navigates straight into the playlist's edit mode), jump to an album's artist.

## Context menus

Every ⋯ across the card (track rows, playlist header, library rows, queue, Now Playing) opens one universal context menu, styled after the Spotify app:

* **Phones** — a bottom sheet with drag-to-dismiss.
* **Tablet / desktop** — a touch-friendly popover anchored to the button you tapped; it flips and clamps to stay fully on screen near edges.
* Items adapt to context: *Add to Queue*, *Add to Playlist*, *Go to Artist* everywhere; *Remove from this Playlist* on playlists you can edit; *Go to Queue* and *Go to Playlist / Album* from the playing surfaces. Opening a menu gives light haptic feedback in the companion app.

## Typeface (optional)

The card is designed around Spotify's **Circular Std** typeface using a compact type scale measured off the native app. The font is commercially licensed, so it is **not bundled** — without it the card falls back to your system font stack and everything still works.

If you own the Circular Std family, drop these four files into `/config/www/spotify-browser-fonts/`:

```
CircularStd-Book.woff2      # weight 400
CircularStd-Medium.woff2    # weight 500
CircularStd-Bold.woff2      # weight 700
CircularStd-Black.woff2     # weight 900
```

The card registers the `@font-face` set automatically (served from `/local/spotify-browser-fonts/`) and uses it everywhere; missing files fall back silently.


## Preview

### Desktop
<p align="center">
  <img src="images/desktop_1.png" width="49%" alt="Desktop Home" />
  <img src="images/desktop_2.png" width="49%" alt="Desktop Player" />
</p>
<p align="center">
  <img src="images/desktop_3.png" width="49%" alt="Desktop Search" />
  <img src="images/desktop_4.png" width="49%" alt="Desktop Settings" />
</p>

### Mobile
<p align="center">
  <img src="images/mobile_1.PNG" width="24%" alt="Mobile Home" />
  <img src="images/mobile_2.PNG" width="24%" alt="Mobile Player" />
  <img src="images/mobile_3.PNG" width="24%" alt="Mobile Playlists" />
  <img src="images/mobile_4.PNG" width="24%" alt="Mobile Devices" />
</p>


## Installation

### Option 1: HACS (Recommended)

1. Open **HACS** in Home Assistant.
2. Click the three dots in the top-right corner and select **Custom repositories**.
3. Add `https://github.com/BWilky/HA-Spotify-Browser` under **Repository** and select **Lovelace** as the **Category**.
4. Click **Add**, then find and install the **Spotify Browser** card.
5. HACS will automatically register the dashboard resource.

### Option 2: Manual Installation

1. Copy the `spotify-browser` folder to your Home Assistant `www/` directory.
2. Register the resource in your Lovelace dashboard configuration:

```yaml
resources:
  - url: /local/spotify-browser/index.js
    type: module
```

## Configuration

You can configure the card either at the root level of your Lovelace dashboard config or directly inside a custom card.

> **Schema v2** — the configuration schema was rewritten (breaking). Ten root keys, everything nested at most three levels deep, snake_case throughout, no legacy aliases. Unknown, renamed, or removed keys log a one-time console warning with a hint. See [Migrating from v1](#migrating-from-v1).

**Every option group follows one shorthand rule:**
* *omitted* → sensible defaults
* `true` → enabled with defaults
* `false` → disabled
* *scalar/list* → the group's primary value (e.g. `auto_close: 300`, `volume: 25`)
* *object* → your keys merged over the defaults

### Card Configuration

Add the card to a dashboard view:

```yaml
type: custom:spotify-browser-card
entity: media_player.spotify_user
browser:
  cache_size: 15
appearance:
  performance: auto
```

### Dashboard Root Configuration

Define the configuration globally under the `spotify_browser:` key in your Lovelace dashboard YAML:

```yaml
spotify_browser:
  entity: media_player.spotify_user
  browser:
    home_on_exit: 300
    cache_size: 15
```

### Configuration Reference

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `entity` | string | none | The primary Spotify `media_player` entity. Required unless `accounts` is set. |
| `accounts` | list | none | Accounts for multi-user switching (`entity`, `name`, `image`, `hash`, `default`). |
| `browser` | object | — | Shell behavior: trigger `hash`, `auto_close`, `home_on_exit`, `cache_size`, `debug`. |
| `appearance` | object | — | `performance` profile, `animations`, and desktop window sizing. |
| `home` | object | — | Home screen: section `sort`, `pinned` toggle, `made_for_you` content. |
| `devices` | object | — | Device picker `default` + `icons`, and `volume` behavior/rules. |
| `queue` | object | — | Desktop queue sidebar + mini-player buttons. |
| `sonos` | object / bool | off | Sonos speaker support via the HA Sonos integration. |
| `storage` | object | — | Persistence backend: `sensor`, `event`, `script`. |
| `integrations` | object | — | External services (`lastfm`). |

### Detailed Option Schemas

#### browser
* `hash` (string): URL hash that opens the browser (default `spotify-browser`; `#` added automatically).
* `auto_close` (number / object): Close the overlay after N seconds with no user interaction (taps, scrolling, keys) while it is open. `0`/omitted disables. Idle time is wall-clock based, so time spent backgrounded counts. On phones the overlay already closes when the app goes to background — this mainly matters for wall tablets and desktop browsers left idle.
* `home_on_exit` (bool / number / object): Reset the view to Home on close/reopen. `true` (default) always resets; `false` remembers the last page; a number (or `{timeout: N}`) remembers the last page for N seconds, then resets.
* `cache_size` (number): Maximum pages retained in history (default `10`).
* `debug` (boolean): Verbose console logging (default `false`).

#### appearance
* `performance` (string): `auto` (default — detects weak hardware), `high` (full animations), or `low` (optimized: no blur, trimmed motion). Many iPads don't expose the hardware hints `auto` relies on — set `low` explicitly for a known slow tablet.
* `animations` (bool / object): `false` turns everything off. Object keys: `page_transition` (`fade`/`slide`/`none`), `browser_open`, `blur`. `performance: low` (or auto-detected lite) forces `blur: false` regardless.
* `desktop` (object): Window sizing on desktop viewports: `mode` (`default`/`fixed`/`fullscreen` — setting `width`/`height` implies `fixed`), `width`, `height` (CSS units; bare numbers become px), `fullscreen` (boolean), `margin` (global) and `margin_top`/`margin_bottom`/`margin_left`/`margin_right` (individual overrides).

#### home
* `sort` (list): Section order. Tokens: `pinned`, `recently_played`, `made_for_you`, `favourite_playlists`, `followed_artists`, `favourite_albums`. Unknown tokens warn and are dropped; sections you omit are hidden.
* `pinned` (boolean): Enable the pinned-items section and manager (default `false`). Pins persist via the `storage` sensor — no helper entity needed.
* `made_for_you` (list / object): A list is treated as `content`. Object keys: `content` (playlists/albums — see the full example), `pills` (boolean, genre-pill styling on desktop).

#### devices
* `default` (string): Device ID marked with a ★ in the picker.
* `icons` (list): Icon overrides for the picker: `{name: "Kitchen Speaker", icon: "mdi:speaker"}` (match by `name` or `id`; `icon` accepts `mdi:` names or image URLs).
* `volume` (number / object): A number sets the default volume. Object keys: `fallback` (default `25`), `rules` (list of `{start: 'HH:MM', end: 'HH:MM', level: 0-100}` time-based defaults), `rate_control` (throttle volume calls, default `true`), `optimistic` (update the slider immediately, default `true`).

#### queue
* `open_on_desktop` (boolean): Open the queue sidebar automatically when the browser opens on desktop (default `false`).
* `miniplayer` (bool / object): Mini-player controls row in the queue sidebar. Default: enabled with all buttons. `false` hides the row. Object keys merge over defaults: `shuffle`, `previous`, `next`, `like`, `volume`, `device` (booleans).

#### sonos
Sonos speakers are "restricted" Spotify Connect devices — their playback and queue live on the device, not the Spotify Web API. With this enabled, when playback is on a Sonos speaker the card drives the player **locally through the Home Assistant [Sonos integration](https://www.home-assistant.io/integrations/sonos/)** instead of the Spotify cloud:
* Now-playing state (track, progress, shuffle, repeat, volume) is read from the Sonos `media_player` entity.
* Transport controls (play/pause, next/previous, seek, volume, shuffle, repeat) are sent directly to the Sonos entity.
* Queue is read/added/played via the Sonos integration; in-context track jumps use `offset_position` (Sonos rejects `offset_uri`).

* Playlist/album launches go straight onto the Sonos queue (`media_player.play_media` + `sonos.play_queue`), so "start at track N" works natively. Liked Songs load via SpotifyPlus track favorites (up to 200 tracks, loaded progressively) and jump to the tapped track once it arrives.
* Grouped speakers are controlled through the group coordinator automatically.

SpotifyPlus is still used for browsing, metadata, and as the automatic fallback for launches. Non-Sonos devices are unaffected.
* `enabled` (boolean): Turn on Sonos handling (default: `false`). Shorthand: `sonos: true`, and configuring any `sonos:` key implies enabled unless you set `enabled: false`.
* `prefer_sonos` (boolean): Trust the mapped Sonos entity's own state **first** for now-playing, queue, and controls, only falling back to the SpotifyPlus entity when the speaker has nothing to show (default: `false`). Recommended when a Sonos speaker is the primary player: local Sonos playback is invisible to the Spotify Web API, so the SpotifyPlus entity often sits `idle` while the speaker plays. Requires a `device_map` entry with an `entity`. A playing mapped speaker always wins; a merely *paused* one yields if SpotifyPlus reports live playback on another device.
* `launch_mode` (string): `local` (default) — the card drives the HA Sonos entity directly for playback launches, falling back to SpotifyPlus on failure; `spotifyplus` — all launches route through the SpotifyPlus integration (best when its Spotify Web Player token authentication is configured).
* `device_map` (list): Optional. Speakers are auto-detected by matching the Spotify device name to a Sonos `media_player` friendly name; add entries only to override a wrong match or force Sonos handling:
  * `spotify` (string): Spotify Connect device name (or id).
  * `entity` (string): The Home Assistant Sonos `media_player` entity.
  * `is_sonos` (boolean): Force this device to be treated as Sonos.
* `debug` (boolean): Log `[Sonos]` routing decisions to the console (default: `false`).

**Requirements & notes for best results:**
* SpotifyPlus **v1.0.95 or newer** recommended (group-coordinator handling and the Spotify Web Player token play path).
* Configuring SpotifyPlus's [Spotify Web Player token authentication](https://github.com/thlucas1/homeassistantcomponent_spotifyplus/wiki) is strongly recommended — it lets the fallback path drive Sonos under real Spotify Connect control instead of the slower share-link queue load.
* The Spotify account must be linked in the Sonos app for local launches; the card's multi-account switching does not change which account Sonos plays from.
* Avoid controlling the same speaker from the Sonos app while the card is driving it — the SpotifyPlus maintainer documents erratic behavior under dual control.
* If a Sonos speaker is detected but can't be matched to an HA entity, the card shows a one-time hint and falls back to SpotifyPlus — add a `device_map` entry to fix the mapping.

#### storage
* `sensor` (string): Trigger-template sensor holding persisted data (default `sensor.spotify_browser_data`).
* `event` (string): Event fired to write data (default `spotify_browser_store_data`).
* `script` (string): Optional middle-man script for non-admin/guest write access (`script.` prefix added automatically).

#### integrations
* `lastfm.api_key` (string): Enables "Fans also like" on artist pages via Last.fm.

### Persistent Storage Setup

To enable pinning items and saving device settings, configure a template sensor in your `configuration.yaml` and a helper script in your `scripts.yaml`.

#### 1. Home Assistant Template Sensor

```yaml
template:
  - trigger:
      - platform: event
        event_type: spotify_browser_store_data
    sensor:
      - name: Spotify Browser Data
        unique_id: spotify_browser_data
        state: "{{ now().timestamp() | int }}"
        attributes:
          data: "{{ trigger.event.data.data | to_json }}"
```

#### 2. Helper Script (Optional - allows non-admin/guest editing)

```yaml
spotify_browser_store:
  alias: Spotify Browser Store Data
  mode: queued
  fields:
    data:
      description: Full data object to persist
  sequence:
    - condition: template
      value_template: "{{ data is mapping }}"
    - event: spotify_browser_store_data
      event_data:
        data: "{{ data }}"
```

#### 3. Lovelace Card Storage Reference

```yaml
type: custom:spotify-browser-card
entity: media_player.spotify_user
storage:
  sensor: sensor.spotify_browser_data
  event: spotify_browser_store_data
  script: spotify_browser_store
```

### Multi-Account Support

You can configure multiple Spotify accounts and switch between them within the interface:

```yaml
type: custom:spotify-browser-card
accounts:
  - name: "User A"
    entity: media_player.spotify_user_a
    default: true
    hash: "#user-a"
  - name: "User B"
    entity: media_player.spotify_user_b
    hash: "#user-b"
```

### Migrating from v1

The v2 schema has no legacy aliases — old keys are ignored with a console warning. Every v1 key maps as follows:

| v1 key (and aliases) | v2 |
| :--- | :--- |
| `entity` / `entity_id` | `entity` |
| `spotify_accounts` (item `picture`) | `accounts` (item `image`) |
| `custom_hash` | `browser.hash` |
| `auto_close` / `autoclose` / `auto_close_seconds` | `browser.auto_close` |
| `homeonexit` / `home_on_exit` | `browser.home_on_exit` |
| `cache_size` | `browser.cache_size` |
| `debug` | `browser.debug` |
| `closeondisconnect` / `close_on_disconnect` | **removed** (was never functional) |
| `performance` / `perf` (`full`/`max` → `high`, `lite` → `low`) | `appearance.performance` |
| `animations.*` | `appearance.animations.*` |
| `desktop_style.*` | `appearance.desktop.*` |
| `homescreen.sort` (`recently played` token) / `home_order` | `home.sort` (`recently_played`) |
| `homescreen.sticky.helper` / `homescreen.pinned_items_entity` | `home.pinned: true` (helper entity obsolete — pins live in `storage.sensor`) |
| `homescreen.madeforyou` (`items`, `desktop_pills`) / root `madeforyou` / `desktop_madeforyou_pills` | `home.made_for_you` (`content`, `pills`) |
| `homescreen.cache` / `homescreen.expiry` | **removed** (was never functional) |
| `homescreen.customize` / `custimize` | **removed** (dead feature) |
| `device_playback.helper` / `device_manager` | **removed** (device settings live in `storage.sensor`) |
| `device_playback.hide` | **removed** (was never functional — hide devices via the in-app device manager) |
| `device_playback.show` | `devices.icons` (it only ever set icons) |
| `device_playback.default` / `default_device` | `devices.default` |
| `volume.default` (scalar) / `device_playback.default_volume` | `devices.volume` (scalar) |
| `volume.default.fallback` / `.rules` | `devices.volume.fallback` / `.rules` |
| `volume.slider.rate_control` / `.optimistic` | `devices.volume.rate_control` / `.optimistic` |
| `queue` (list form) | `queue` (object only) |
| `queue.desktop.open_init` | `queue.open_on_desktop` |
| `queue.desktop.miniplayer` | `queue.miniplayer` (object now **merges over defaults**; v1 treated unset buttons as off) |
| `sonos.*` (`device_map[].device`) | unchanged (`device_map[].spotify`) |
| `storage.sensor_entity` / `sensorentity` / `sensor` / root `storage_sensor` | `storage.sensor` |
| `storage.event_type` / `eventtype` / `event` / root `storage_event` | `storage.event` |
| `storage.write_script` / `writescript` / `script` / root `storage_script` | `storage.script` |
| `advanced.similar_artists` | **removed** (was never functional — a Last.fm key alone enables it) |
| `external_providers.lastfm.api_key` | `integrations.lastfm.api_key` |

## Triggers

Open the browser using URL hashes or JavaScript window events.

### URL Hashes

Navigate or link directly to these hashes:
- `#spotify-browser` - Opens the main browser
- `#spotify-browser-now-playing` - Opens the now playing view on mobile
- `#user-a` - Opens the browser and switches to the specified account

### JavaScript Events

Trigger the browser programmatically:

```javascript
// Open the browser
window.dispatchEvent(new CustomEvent('spotify-browser-open'));

// Open directly to mobile now-playing screen
window.dispatchEvent(new CustomEvent('spotify-browser-open-now-playing'));
```

## Complete Configuration Example

Below is a complete configuration example demonstrating all available options:

```yaml
type: custom:spotify-browser-card
entity: media_player.spotify_user

accounts:
  - name: "Bryce"
    entity: media_player.spotify_bryce
    default: true
    hash: "#bryce"
    image: "/local/spotify/bryce.jpg"
  - name: "Alice"
    entity: media_player.spotify_alice
    hash: "#alice"

browser:
  hash: spotify-browser
  auto_close: 0          # seconds idle before closing; 0 disables
  home_on_exit: 300      # remember the last page for 5 minutes
  cache_size: 15
  debug: false

appearance:
  performance: auto      # auto | high | low
  animations:
    page_transition: fade # fade | slide | none
    browser_open: fade
    blur: true
  desktop:
    mode: fixed
    width: 1000px
    height: 700px
    margin: 32px

home:
  sort:
    - pinned
    - recently_played
    - made_for_you
    - favourite_playlists
    - followed_artists
    - favourite_albums
  pinned: true
  made_for_you:
    content:
      - id: "37i9dQZF1DXcBWIGoYBM5M"
        title: "Top Hits"
        type: "playlist"
    pills: true

devices:
  default: "speaker_kitchen"
  icons:
    - name: "Kitchen Speaker"
      icon: mdi:speaker
  volume:
    fallback: 25
    rules:
      - start: '09:00'
        end: '17:00'
        level: 35
      - start: '22:00'
        end: '07:00'
        level: 15
    rate_control: true
    optimistic: true

queue:
  open_on_desktop: true
  miniplayer: true       # or per-button: {shuffle, previous, next, like, volume, device}

sonos:
  enabled: false

storage:
  sensor: sensor.spotify_browser_data
  event: spotify_browser_store_data
  script: spotify_browser_store

integrations:
  lastfm:
    api_key: "YOUR_LASTFM_API_KEY"
```

