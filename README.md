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
4. Add `BWilky/HA-Spotify-Browser` as a repository
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


```
type: custom:spotify-browser-card
entity: media_player.spotifyplus_bryce_peter

closeondisconnect: true
scan_interval: 5

device_playback:
  - default: Office
  - show:  ##one or the other
      - Kitchen
      - iPhone
      - Web Player (Chrome)
  - hide:  ##one or the other
      - Kitchen1
      - Kitchen2
queue:
  - desktop:
      - open_init: true
      - miniplayer:
          previous: true
          next: true
          shuffle: false
          like: true
          volume: false

home_order:
  - madeforyou
  - albums
  - recent
  - favorites
  - artists
madeforyou:
  - likedsongs: true
  - desktop_pills: true
  - playlists_recommended:
      - id: 37i9dQZF1E39suu8OtrpJX
        title: Daily Mix 1
      - id: 37i9dQZF1E39suu8OtrpJX
        title: Daily Mix 1
      - id: 37i9dQZF1E39suu8OtrpJX
        title: Daily Mix 1
      - id: 37i9dQZF1E39suu8OtrpJX
        title: Daily Mix 1
      - id: 37i9dQZF1E39suu8OtrpJX
        title: Daily Mix 1
  - playlists:
      - 3fKOnwgR2v4Qc0DH09KJKz


```

Launch via tap_action url 

```
tap_action:
  action: navigate
  navigation_path: "#spotify-browser"
```
