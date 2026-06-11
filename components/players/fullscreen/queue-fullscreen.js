import { LitElement, html, css } from "../../lit.js";

export class SpotifyQueueFullscreen extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
                width: 100%;
                height: 100%;
                background: #000;
                color: #fff;
            }
            .fullscreen-placeholder {
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100%;
            }
        `;
    }

    render() {
        return html`
            <div class="fullscreen-placeholder">
                <h1>Fullscreen Queue Coming Soon</h1>
            </div>
        `;
    }
}
// define if needed, or wait for implementation
// customElements.define('spotify-queue-fullscreen', SpotifyQueueFullscreen);
