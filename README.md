# HA-Spotify-Browser
A homeassistant spotify browser. Requires the HomeAssistant Spotify Plus integration. https://github.com/thlucas1/homeassistantcomponent_spotifyplus




```
type: custom:spotify-browser-card
entity: media_player.***
default_device: "Office Speaker"

# --- Features ---
queue_miniplayer: true
scan_interval: 10          # Refresh every 10s while open
auto_close_seconds: 300    # Close after 5 minutes idle
desktop_madeforyou_pills: true

# --- Performance ---
homescreen:
  cache: true
  expiry: 60

# --- Layout Ordering ---
home_order:
  - madeforyou
  - recent
  - favorites
  - artists
  - albums

# --- Custom Dashboard Row ---
madeforyou:
  - likedsongs: true
  - playlists_recommended:
      - id: 37i9dQZF1E39suu8OtrpJX
        title: "Discover Weekly"
      - id: 37i9dQZF1E363TX1pYJjAC
        title: "Release Radar"
  - playlists:
      - 37i9dQZF1E363TX1pYJjAC
      - 37i9dQZF1E363TX1pYJjAC

```

Launch via tap_action url 

```
tap_action:
  action: navigate
  navigation_path: "#spotify-browser"
```
