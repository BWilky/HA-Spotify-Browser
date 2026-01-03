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
| `default_device` | string | `null` | The specific name of the Spotify Connect device to select by default on load. |
| `closeondisconnect` | boolean | `true` | Automatically closes the browser view if the Spotify client disconnects. |
| `queue_miniplayer` | boolean | `false` | Quickly enables the mini-player queue view. |
| `device_playback` | list | `[]` | Controls which devices appear in the device picker. See **Device Playback** below. |
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
Control which devices are shown or hidden in the device picker, and which is default.

| Option | Type | Description |
| :--- | :--- | :--- |
| `default` | string | The exact name of the device to select automatically (e.g., "Office Speaker"). |
| `show` | list | A list of device names to **explicitly show**. |
| `hide` | list | A list of device names to **explicitly hide**. |

**Example:**
```yaml
device_playback:
  - default: "Kitchen Speaker"
  - hide:
      - "Bedroom TV"
      - "Web Player (Chrome)"
```

### Queue Settings
Customize the behavior of the queue and mini-player controls.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `desktop` | list | `[]` | Configuration for the desktop view. |
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
* `provider`: String (e.g. `'spotify'`)
* `limit`: Number (Default `30`)
* `dontstopthemusic`: Boolean (Default `true`)

```

Launch via tap_action url 

```
tap_action:
  action: navigate
  navigation_path: "#spotify-browser"
```
