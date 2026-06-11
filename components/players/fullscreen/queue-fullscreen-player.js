import { LitElement, html, css } from "../../lit.js";

export class SpotifyQueueFullscreenPlayer extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
            }
        `;
    }

    render() {
        return html`<div>Fullscreen Player Placeholder</div>`;
    }
}
