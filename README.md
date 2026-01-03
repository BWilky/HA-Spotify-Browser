# 🎵 Spotify Browser Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/custom-components/hacs)
[![GitHub Release](https://img.shields.io/github/v/release/bwilky/ha-spotify-browser?color=blue)](https://github.com/bwilky/ha-spotify-browser/releases)


Spotify Browser Card is a card that allows you to browser, search, play and control your spotify account on any connected devices. It is not a playback card. This card depends on Spotify Plus Component. https://github.com/thlucas1/homeassistantcomponent_spotifyplus

**Note:** This is a new project and you will likely encouter bugs. Please report them and suggest any features you're looking for.


<img width="396" height="225" src="https://github.com/BWilky/HA-Spotify-Browser/blob/main/images/spotbrowser_1.jpg" />
<img width="396" height="225" src="https://github.com/BWilky/HA-Spotify-Browser/blob/main/images/spotbrowser_2.jpg" />
<img width="396" height="225" src="https://github.com/BWilky/HA-Spotify-Browser/blob/main/images/spotbrowser_3.jpg" />
<img width="396" height="225" src="https://github.com/BWilky/HA-Spotify-Browser/blob/main/images/spotbrowser_4.jpg" />
<img width="396" height="225" src="https://github.com/BWilky/HA-Spotify-Browser/blob/main/images/spotbrowser_5.jpg" />
## Installation

<details>
<summary>HACS</summary>

1. Open HACS in your Home Assistant instance
2. Click the three dots in the top right corner
3. Select "Custom repositories"
4. Add `https://github.com/BWilky/HA-Spotify-Browser` as a repository
5. Set category to "Dashboard"
6. Click "Add"
7. Search for "Spotify Browser Card"
8. Install it and reload your browser

</details>


<details>
<summary>Manual Installation</summary>

1. Grab the latest release from the [releases page](https://github.com/bwilky/ha-spotify-browser/releases)
2. Copy the JavaScript file to your `www/` directory in your Home Assistant setup
3. Add the resource to your Lovelace config:

```yaml
resources:
	- url: /local/spotify-browser.js
		type: module
```

4. Refresh your browser

</details>
## Configuration Reference

### Main Configuration

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `type` | string | **Required** | Must be `custom:spotify-browser-card`. |
| `entity` | string | **Required** | The `media_player.spotifyplus_...` entity ID. (Not required if using `spotify_accounts`). |
| `spotify_accounts` | list | `[]` | A list of accounts to switch between. See **Account Object** below. |
| `performance_mode` | boolean | `false` | If `true`, disables background blur (glassmorphism) and heavy transparency effects. **Recommended for older tablets.** |
| `closeondisconnect` | boolean | `true` | Automatically closes the browser view if the Spotify client disconnects. |
| `device_playback` | object | `{}` | Controls default device and visibility. See **Device Playback** below. |
| `queue` | object | `{}` | Controls the queue sidebar and miniplayer buttons. See **Queue Settings** below. |
| `homescreen` | object | `See Desc` | Configures caching. Default: `{ cache: true, expiry: 60 }`. |
| `advanced` | object | `null` | Advanced features like Last.FM integration and Radio settings. |

### Spotify Accounts Object
Define multiple accounts to easily switch between users.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `name` | string | **Required** | The display name for the user (e.g., "Husband"). |
| `entity` | string | **Required** | The `media_player.spotifyplus_...` entity for this specific user. |
| `default` | boolean | `false` | Set `true` to make this the active account when the card loads. |
| `hash` | string | `null` | Optional URL hash (e.g., `spotify-wife`) for deep-linking directly to this account. |

### Device Playback
Control which devices are shown, hidden, or selected by default.

| Option | Type | Description |
| :--- | :--- | :--- |
| `default` | string | The exact name of the device to select automatically (e.g., "Bryce’s MacBook Pro"). |
| `show` | list | A list of device names to **explicitly show**. |
| `hide` | list | A list of device names to **explicitly hide**. |

### Queue Settings
The queue is enabled by default. You can customize the sidebar behavior and miniplayer buttons here.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `desktop` | object | `{}` | Configuration for the desktop view. Set to `false` to disable the queue entirely. |
| `desktop.open_init` | boolean | `false` | If `true`, the queue sidebar opens automatically on load. |
| `desktop.miniplayer` | object | `See Desc` | Toggle specific buttons on the miniplayer. |

**Miniplayer Overrides:**
Inside `desktop.miniplayer`, you can set the following to `true` or `false` to show/hide controls:
* `shuffle`, `previous`, `next`, `like`, `volume`, `device`

### Advanced & External Providers

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `external_providers.lastfm.api_key` | string | `null` | Your Last.FM API key. Required for "Similar Artists" feature. |
| `advanced.similar_artists` | object | `{ limit: 10 }` | Settings for the similar artists recommendation engine. |
| `advanced.radio_track` | object | `null` | Settings for radio generation. |

**Radio Track Object:**
* `provider`: String (e.g. `'spotify'` or `'lastfm'`)
* `limit`: Number (Default `30`)
* `dontstopthemusic`: Boolean (Default `true`)

### Example Configuration

```yaml
type: custom:spotify-browser-card
entity: media_player.spotifyplus_bryce_peter
performance_mode: false
closeondisconnect: true

# Advanced Settings
advanced:
  radio_track:
    provider: lastfm
    limit: 5
  similar_artists:
    provider: lastfm
    limit: 10

# External API Keys
external_providers:
  lastfm:
    api_key: YOUR_LASTFM_API_KEY

# Queue Configuration
queue:
  desktop:
    open_init: true
    miniplayer:
      previous: true
      next: true
      shuffle: false
      like: true
      volume: true
      device: true

# Multi-Account Setup
spotify_accounts:
  - name: Bryce
    entity: media_player.spotifyplus_bryce_peter
    hash: spotify-bryce
    default: true
  - name: Barnabas
    entity: media_player.spotifyplus_the_station
    hash: spotify-barnabas

# Home Screen Sorting
home_order:
  - madeforyou
  - albums
  - recent
  - favorites
  - artists

# Device Management
device_playback:
  default: Bryce’s MacBook Pro
  hide:
    - Kitchen1
    - Kitchen2
    - Kitchen

# Made For You Content
madeforyou:
  likedsongs: true
  desktop_pills: true
  playlists_recommended:
    - id: 37i9dQZF1E39suu8OtrpJX
      title: Daily Mix 1
  playlists:
    - 3fKOnwgR2v4Qc0DH09KJKz
