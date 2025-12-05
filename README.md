# HA-Spotify-Browser
A homeassistant spotify browser. Requires the HomeAssistant Spotify Plus integration. https://github.com/thlucas1/homeassistantcomponent_spotifyplus




```
type: custom:spotify-browser-card
entity: media_player.spotifyplus_bryce_peter

closeondisconnect: true
scan_interval: 5

device_playback:
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
