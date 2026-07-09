import { spotifyUriFromContentId } from '../../utils.js';

/**
 * Sonos integration bridge.
 *
 * Sonos is a "restricted" Spotify Connect device: its playback queue is owned by
 * the Sonos local queue, not the Spotify Web API. Two SpotifyPlus paths break as
 * a result:
 *   1. Context jumps must use `offset_position` (Sonos rejects `offset_uri`).
 *   2. Queue read/add/play-from must go through Home Assistant's own Sonos
 *      integration (a separate `media_player.*` entity), not SpotifyPlus.
 *
 * This helper centralises Sonos detection, Spotify-device -> HA-entity mapping,
 * and the HA Sonos service calls. It is a no-op unless `config.sonos.enabled`.
 */
export class SonosBridge {
    /** @param {object} hass @param {{enabled:boolean, deviceMap:Array}} sonosConfig */
    constructor(hass, sonosConfig = null) {
        this.hass = hass;
        this.config = sonosConfig || { enabled: false, deviceMap: [] };
    }

    setHass(hass) { this.hass = hass; }

    get enabled() { return !!this.config?.enabled; }

    /** Console logging gated behind `sonos.debug: true` — for verifying the bypass. */
    log(...args) {
        if (this.config?.debug) console.log('%c[Sonos]', 'color:#1ed760;font-weight:bold', ...args);
    }

    /** The configured device_map (array of { spotify, entity, isSonos }). */
    get _deviceMap() { return this.config?.deviceMap || []; }

    /** Find a device_map entry matching a Spotify device name or id (case-insensitive). */
    _mapEntryFor(deviceNameOrId) {
        if (!deviceNameOrId) return null;
        const needle = String(deviceNameOrId).toLowerCase();
        return this._deviceMap.find(m =>
            m.spotify && String(m.spotify).toLowerCase() === needle
        ) || null;
    }

    /**
     * Whether the playback target is a Sonos speaker.
     * @param device  Resolved device object (idle launch); may be null for the active device.
     * @param attributes  The SpotifyPlus entity attributes (used for the active device).
     */
    isSonosTarget(device = null, attributes = {}) {
        if (!this.enabled) return false;

        // 1. Manual override via device_map (matches name or id).
        const name = device?.name || attributes?.sp_device_name || attributes?.source;
        const id = device?.id || attributes?.sp_device_id;
        const entry = this._mapEntryFor(name) || this._mapEntryFor(id);
        if (entry?.isSonos) return true;

        // 2. Brand reported on the resolved device object (from get_spotify_connect_devices).
        if (device?.brand && String(device.brand).toLowerCase().includes('sonos')) return true;

        // 3. Brand reported on the active SpotifyPlus entity attributes (best-effort;
        //    the field isn't documented, so it's a bonus signal, not the primary one).
        if (attributes?.sp_device_is_brand_sonos === true) return true;
        if (attributes?.sp_device_is_brand_sonos === 'true') return true;

        // 4. Primary auto-detection: the active device name resolves to a
        //    media_player that the HA entity registry says is on the Sonos platform.
        const entity = this.resolveSonosEntity(device, attributes);
        if (entity && this.hass?.entities?.[entity]?.platform === 'sonos') return true;

        return false;
    }

    /**
     * Resolve the Home Assistant Sonos `media_player` entity for a target device.
     * Prefers an explicit device_map entry, otherwise auto-detects by matching the
     * Spotify device name against Sonos-platform media_players.
     */
    resolveSonosEntity(device = null, attributes = {}) {
        const name = device?.name || attributes?.sp_device_name || attributes?.source;
        const id = device?.id || attributes?.sp_device_id;

        // 1. Explicit override.
        const entry = this._mapEntryFor(name) || this._mapEntryFor(id);
        if (entry?.entity) return entry.entity;

        if (!name || !this.hass) return null;
        const needle = String(name).toLowerCase().trim();

        // 2. Auto-detect: Sonos-platform media_players whose friendly name matches.
        const entitysMeta = this.hass.entities || {};
        const states = this.hass.states || {};
        const candidates = Object.keys(states).filter(eid => eid.startsWith('media_player.'));

        const friendly = (eid) => String(states[eid]?.attributes?.friendly_name || '').toLowerCase().trim();
        const isSonosPlatform = (eid) => entitysMeta[eid]?.platform === 'sonos';

        // Prefer entities the frontend knows are on the Sonos platform.
        const sonosEids = candidates.filter(isSonosPlatform);
        const pool = sonosEids.length ? sonosEids : candidates;

        return pool.find(eid => friendly(eid) === needle)
            || pool.find(eid => friendly(eid).includes(needle) || needle.includes(friendly(eid)))
            || null;
    }

    /* --- Spotify id helpers --- */

    /** Normalize one `sonos.get_queue` item into the card's track shape. */
    static _normalizeQueueItem(item) {
        const uri = spotifyUriFromContentId(item?.media_content_id);
        const id = uri ? uri.split(':')[2] : null;
        const artistName = item?.media_artist || item?.media_album_artist || '';
        const images = item?.media_image_url ? [{ url: item.media_image_url }] : [];
        return {
            uri: uri || item?.media_content_id || '',
            id,
            name: item?.media_title || 'Unknown',
            artists: artistName ? [{ name: artistName }] : [],
            album: { name: item?.media_album_name || '', images }
        };
    }

    /* --- HA Sonos service calls --- */

    /**
     * Read a Sonos speaker's local queue. Returns an array of normalized track
     * objects (card shape), or null on failure.
     */
    async getQueue(entity) {
        if (!entity || !this.hass) return null;
        try {
            const resp = await this.hass.callWS({
                type: 'call_service',
                domain: 'sonos',
                service: 'get_queue',
                service_data: { entity_id: entity },
                return_response: true
            });
            // Response shape: { response: { <entity_id>: [items] } } or an array.
            let payload = resp?.response ?? resp;
            let items = [];
            if (Array.isArray(payload)) items = payload;
            else if (payload && typeof payload === 'object') {
                items = payload[entity] || Object.values(payload).find(v => Array.isArray(v)) || [];
            }
            const tracks = items.map(SonosBridge._normalizeQueueItem);
            this.log(`get_queue(${entity}) → ${tracks.length} items (LOCAL Sonos queue, bypassing SpotifyPlus)`);
            return tracks;
        } catch (e) {
            console.warn('[SonosBridge] get_queue failed:', e);
            return null;
        }
    }

    /**
     * Append a track to the Sonos queue. mode: 'add' | 'next' | 'play' | 'replace'.
     */
    async addToQueue(entity, uri, mode = 'add') {
        if (!entity || !uri || !this.hass) return { success: false };
        try {
            this.log(`addToQueue(${entity}, ${uri}, ${mode}) → LOCAL Sonos enqueue`);
            await this.hass.callService('media_player', 'play_media', {
                entity_id: entity,
                media_content_id: uri,
                media_content_type: 'music',
                enqueue: mode
            });
            return { success: true };
        } catch (e) {
            console.error('[SonosBridge] addToQueue failed:', e);
            return { success: false, error: e };
        }
    }

    /** Jump to a 0-based position in the Sonos queue and play it. */
    async playQueuePosition(entity, position) {
        if (!entity || position == null || !this.hass) return { success: false };
        try {
            this.log(`playQueuePosition(${entity}, ${position}) → LOCAL Sonos jump`);
            // sonos.play_queue uses a 0-based queue_position.
            await this.hass.callService('sonos', 'play_queue', {
                entity_id: entity,
                queue_position: position
            });
            return { success: true };
        } catch (e) {
            console.error('[SonosBridge] playQueuePosition failed:', e);
            return { success: false, error: e };
        }
    }
}
