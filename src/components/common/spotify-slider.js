import { LitElement, html, css } from "../../lit.js";

export class SpotifySlider extends LitElement {
    static get properties() {
        return {
            value: { type: Number },
            min: { type: Number },
            max: { type: Number },
            step: { type: Number },
            disabled: { type: Boolean, reflect: true }
        };
    }

    static get styles() {
        return css`
            :host {
                display: block;
                width: 100%;
                height: 100%;
                position: relative;
                cursor: pointer;
                user-select: none;
                touch-action: none; 
            }

            .slider-container {
                position: relative;
                width: 100%;
                height: 100%;
                border-radius: 12px; /* Inherit or force? Let's assume container handles outer radius, but slider needs to fill */
                overflow: hidden;
            }

            /* The 'Track' background is assumed to be the container background provided by parent, 
               but we can add a subtle internal track if needed. 
               For now, we rely on the parent wrapper for the main 'card' background 
               or we make this component FULLY handle the visual.
               
               Plan says: "Encapsulate the 'Tile Card' styles (track, fill, marker)".
            */
            
            /* Disable transition during drag to prevent jank */
            .slider-container.dragging .slider-fill {
                transition: none;
            }

            .slider-track {
                position: absolute;
                top: 0; left: 0;
                width: 100%; height: 100%;
                background: transparent; /* Parent sets the inactive color */
            }

            .slider-fill {
                position: absolute;
                top: 0; left: 0;
                height: 100%;
                background: var(--spf-brand, #1ed760);
                opacity: 0.9;
                transition: width 0.1s linear;
                /* Add a marker at the end */
            }

            .slider-marker {
                position: absolute;
                top: 50%;
                right: 6px; /* Offset from end of fill */
                transform: translateY(-50%);
                width: 4px;
                height: 20px;
                background: rgba(0,0,0,0.5);
                border-radius: 2px;
                pointer-events: none;
            }

            :host([disabled]) {
                cursor: default;
            }

            :host([disabled]) .slider-fill {
                opacity: 0.35;
            }

            :host([disabled]) .native-input {
                cursor: default;
                pointer-events: none;
            }

            /* Native input overlay for accessibility and interaction */
            .native-input {
                position: absolute;
                top: 0; left: 0;
                width: 100%; height: 100%;
                opacity: 0;
                margin: 0;
                padding: 0;
                cursor: pointer;
                z-index: 2;
            }
        `;
    }

    constructor() {
        super();
        this.value = 0;
        this.min = 0;
        this.max = 100;
        this.step = 1;
        this.disabled = false;
        this._isDragging = false;
    }

    _handleInput(e) {
        e.stopPropagation(); // Stop propagation of native input
        if (this.disabled) return;
        this.value = Number(e.target.value);
        this.dispatchEvent(new CustomEvent('input', {
            detail: { value: this.value },
            bubbles: true,
            composed: true
        }));
    }

    _handleChange(e) {
        e.stopPropagation();
        if (this.disabled) return;
        this.value = Number(e.target.value);
        this.dispatchEvent(new CustomEvent('change', {
            detail: { value: this.value },
            bubbles: true,
            composed: true
        }));
    }

    _handlePointerDown() {
        if (this.disabled) return;
        this._isDragging = true;
        this.requestUpdate();
    }

    _handlePointerUp() {
        this._isDragging = false;
        this.requestUpdate();
    }

    render() {
        // Calculate percentage for fill width
        const range = this.max - this.min;
        const percent = range === 0 ? 0 : ((this.value - this.min) / range) * 100;

        return html`
            <div class="slider-container ${this._isDragging ? 'dragging' : ''}">
                <div class="slider-track"></div>
                <div class="slider-fill" style="width: ${percent}%">
                    <div class="slider-marker"></div>
                </div>
                <input 
                    type="range" 
                    class="native-input"
                    .min=${this.min} 
                    .max=${this.max} 
                    .step=${this.step} 
                    .value=${this.value}
                    ?disabled=${this.disabled}
                    @input=${this._handleInput}
                    @change=${this._handleChange}
                    @pointerdown=${this._handlePointerDown}
                    @pointerup=${this._handlePointerUp}
                    @pointercancel=${this._handlePointerUp}
                >
            </div>
        `;
    }
}

customElements.define('spotify-slider', SpotifySlider);
