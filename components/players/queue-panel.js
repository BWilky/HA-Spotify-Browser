import { LitElement, html, css } from "../../lit.js";
import { fireHaptic } from "../../utils.js";
import { artFallbackStyles } from '../../styles/shared-styles.js';
import { playingBarsIcon } from '../common/icons.js';
import { renderQueueRow } from './queue-row.js';
import '../bottom-sheet.js';

/**
 * Mobile "Queue" bottom sheet, styled after the Spotify app. Slides up from the
 * now-playing view's queue button. Shows the current track first (with an
 * equalizer accent + play/pause), then the upcoming queue, with a Queued /
 * Recently Played tab switch at the bottom.
 *
 * Reorder/Edit, shuffle, repeat and the sleep timer are intentionally omitted —
 * the SpotifyPlus API can't drive them. Tapping a row plays that track.
 *
 * Driven by the app: `state` (PlayerController state: track/isPlaying/queue/
 * recentTracks), `playerController` (actions + refresh), `hass`/`config` (to read
 * the playing context name). Emits `close`.
 */
export class SpotifyQueuePanel extends LitElement {
    static get properties() {
        return {
            visible: { type: Boolean, reflect: true },
            hass: { type: Object },
            config: { type: Object },
            state: { type: Object },
            playerController: { type: Object },
            _tab: { type: String, state: true },
        };
    }

    static get styles() {
        return [artFallbackStyles, css`
            :host { display: contents; }

            .q-head { flex-shrink: 0; margin-bottom: 8px; }
            .q-title { font-size: var(--spf-text-2xl, 26px); font-weight: 900; }
            .q-sub {
                font-size: var(--spf-text-base, 13.5px); color: var(--spf-text-sub, #b3b3b3); margin-top: 2px;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .q-sub b { color: #fff; font-weight: 700; }

            .q-scroll {
                flex: 1; min-height: 0;
                overflow-y: auto; -webkit-overflow-scrolling: touch;
                margin: 0 -4px;
            }

            .row {
                display: flex; align-items: center; gap: 14px;
                padding: 10px 4px; cursor: pointer;
            }
            .art {
                width: 52px; height: 52px; border-radius: 4px; flex-shrink: 0;
                background-size: cover; background-position: center;
                background-color: var(--spf-skeleton-bg, #282828);
            }
            .meta { flex: 1; min-width: 0; }
            .name {
                font-size: var(--spf-text-md, 15px); font-weight: 700; color: #fff;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                display: flex; align-items: center; gap: 8px;
            }
            .sub {
                font-size: var(--spf-text-base, 13.5px); color: var(--spf-text-sub, #b3b3b3); margin-top: 2px;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .row.now .name { color: var(--spf-brand, #1ed760); }
            .eq { width: 16px; height: 16px; flex-shrink: 0; display: inline-flex; }
            .eq svg { width: 100%; height: 100%; fill: var(--spf-brand, #1ed760); }

            .np-toggle {
                flex-shrink: 0; width: 44px; height: 44px; border-radius: 50%;
                background: #fff; color: #000; border: none; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
            }
            .np-toggle:active { transform: scale(0.94); }
            .np-toggle svg { width: 22px; height: 22px; fill: #000; }

            .row-menu-btn {
                flex-shrink: 0; width: 40px; height: 40px;
                background: transparent; border: none; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                color: var(--spf-text-sub, #b3b3b3);
            }
            .row-menu-btn:hover { color: var(--spf-text-main, #fff); }
            .row-menu-btn svg { fill: currentColor; }

            .empty { text-align: center; color: var(--spf-text-sub, #b3b3b3); padding: 40px 0; font-size: var(--spf-text-base, 13.5px); }

            /* Bottom tab switch */
            .tabs {
                flex-shrink: 0; display: flex; gap: 10px; padding-top: 14px;
            }
            .tab {
                flex: 1; padding: 12px; border-radius: 8px; cursor: pointer;
                background: rgba(255,255,255,0.08); color: var(--spf-text-sub, #b3b3b3);
                border: none; font-size: var(--spf-text-base, 13.5px); font-weight: 700; text-align: center;
                transition: color 0.15s ease, background 0.15s ease;
            }
            .tab.active { background: rgba(255,255,255,0.18); color: #fff; }
        `];
    }

    constructor() {
        super();
        this.visible = false;
        this._tab = 'queue';
    }

    // Animated bars while playing (shared icon), frozen bars while paused.
    _eqIcon() {
        return this.state?.isPlaying
            ? html`<span class="eq">${playingBarsIcon(16)}</span>`
            : html`<span class="eq"><svg viewBox="0 0 24 24"><rect x="3" y="10" width="4" height="11" rx="1"/><rect x="10" y="5" width="4" height="16" rx="1"/><rect x="17" y="13" width="4" height="8" rx="1"/></svg></span>`;
    }

    _context() {
        const attrs = this.hass?.states?.[this.config?.entity]?.attributes || {};
        return attrs.media_playlist || '';
    }

    _close() { this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })); }

    _setTab(tab) {
        if (this._tab === tab) return;
        this._tab = tab;
        if (tab === 'recent') this.playerController?.refreshRecent();
        else this.playerController?.refreshQueue();
    }

    _togglePlay(e) {
        e.stopPropagation();
        fireHaptic('medium');
        this.playerController?.pause(); // pause() toggles play/pause
    }

    _playTrack(track) {
        if (!track) return;
        fireHaptic('light');
        this.playerController?.playTrackFromQueue(track);
    }

    _trackMenu(e, track) {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('open-track-menu', {
            detail: {
                name: track?.name,
                artist: track?.artists?.map(a => a.name).join(', ') || '',
                album: track?.album?.name || '',
                uri: track?.uri,
                id: track?.id,
                image: track?.album?.images?.[0]?.url,
                anchor: e.currentTarget.getBoundingClientRect(),
                context: { surface: 'queue', sourceUri: this.playerController?.sourceContextUri() || null }
            },
            bubbles: true, composed: true
        }));
    }

    _row(track, { now = false } = {}) {
        return renderQueueRow(track, {
            variant: 'panel',
            active: now,
            onClick: () => now ? null : this._playTrack(track),
            titleIcon: now ? this._eqIcon() : null,
            trailing: now ? html`
                <button class="np-toggle" @click=${this._togglePlay} aria-label="${this.state?.isPlaying ? 'Pause' : 'Play'}">
                    <svg viewBox="0 0 24 24"><path d="${this.state?.isPlaying ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z'}"/></svg>
                </button>
            ` : html`
                <button class="row-menu-btn" @click=${(e) => this._trackMenu(e, track)} aria-label="More options">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
                </button>
            `,
        });
    }

    _renderQueueTab() {
        const np = this.state?.track;
        const queue = this.state?.queue || [];
        return html`
            ${np ? this._row(np, { now: true }) : ''}
            ${queue.length
                ? queue.map(t => this._row(t))
                : html`<div class="empty">Nothing queued up next.</div>`}
        `;
    }

    _renderRecentTab() {
        const recent = this.state?.recentTracks || [];
        if (!recent.length) return html`<div class="empty">No recently played tracks.</div>`;
        return html`${recent.map(item => this._row(item.track || item))}`;
    }

    render() {
        const context = this._context();
        return html`
            <spotify-bottom-sheet .visible=${this.visible}>
                <div class="q-head">
                    <div class="q-title">Queue</div>
                    ${context ? html`<div class="q-sub">Playing <b>${context}</b></div>` : ''}
                </div>

                <div class="q-scroll">
                    ${this._tab === 'queue' ? this._renderQueueTab() : this._renderRecentTab()}
                </div>

                <div class="tabs">
                    <button class="tab ${this._tab === 'queue' ? 'active' : ''}" @click=${() => this._setTab('queue')}>Queued</button>
                    <button class="tab ${this._tab === 'recent' ? 'active' : ''}" @click=${() => this._setTab('recent')}>Recently Played</button>
                </div>
            </spotify-bottom-sheet>
        `;
    }
}

customElements.define('spotify-queue-panel', SpotifyQueuePanel);
