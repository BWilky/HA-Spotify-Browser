import { html, css } from "../../lit.js";
import { deviceTypeIcon, castIcon } from '../common/icons.js';

/**
 * One row of a "pick a Connect device" list: icon, name, a type line with the
 * cast glyph, and an optional trailing slot. Shared by the "Connect to a
 * device" picker (device-picker-large) and the mobile Connect sheet
 * (connect-panel) so the two lists cannot drift apart again.
 *
 * The sidebar dropdown (device-picker-small) and the device manager's lists
 * are deliberately different UIs and do not use this.
 */

/**
 * The custom icon configured for a device in `config.devices.icons`
 * (matched by id, then name), rendered as an `ha-icon` for `mdi:` names or an
 * `<img>` for URLs — or the device-type icon when none is configured.
 */
export function deviceIconFor(device, config) {
    const icons = config?.devices?.icons;
    const entry = icons && icons.length
        ? icons.find(e => (e.id && e.id === device.id) || (e.name && e.name === device.name))
        : null;
    const icon = entry ? entry.icon : null;
    if (icon) {
        return icon.startsWith('mdi:')
            ? html`<ha-icon icon="${icon}"></ha-icon>`
            : html`<img src="${icon}" alt="">`;
    }
    return deviceTypeIcon(device.type);
}

/**
 * @param {object} device - merged device object (DeviceManager.getMergedDevices / normalizeDevice).
 * @param {object} opts
 * @param {boolean} [opts.active]   - green "active" styling.
 * @param {Function} opts.onSelect  - click handler (receives the device).
 * @param {*} [opts.icon]           - icon template (default: the device-type icon).
 * @param {*} opts.subtitle         - content after the cast glyph on the type line.
 * @param {*} [opts.trailing]       - content after the text (e.g. playing bars).
 */
export function renderDeviceRow(device, { active = false, onSelect, icon, subtitle, trailing = '' } = {}) {
    return html`
        <div class="row ${active ? 'active' : ''}" @click=${() => onSelect?.(device)}>
            <div class="row-ic">${icon ?? deviceTypeIcon(device.type)}</div>
            <div class="row-text">
                <div class="row-name">${device.name}</div>
                <div class="row-type">${castIcon}${subtitle}</div>
            </div>
            ${trailing}
        </div>`;
}

/**
 * Row CSS shared by both lists. Hosts may add their own touches on top (the
 * picker adds a press highlight and ellipsis on the type line); these rules
 * are the ones the two lists had in common, plus the custom-icon (img /
 * ha-icon) and trailing-slot rules, which only apply when those are rendered.
 */
export const deviceRowStyles = css`
    .row {
        display: flex; align-items: center; gap: 16px;
        padding: 14px 4px;
        cursor: pointer;
    }
    .row-ic {
        width: 26px; height: 26px; flex-shrink: 0;
        color: rgba(255,255,255,0.85);
        display: flex; align-items: center; justify-content: center;
    }
    .row-ic svg, .row-ic img { width: 100%; height: 100%; fill: currentColor; }
    .row-ic ha-icon { --mdc-icon-size: 26px; }
    .row.active .row-ic { color: var(--spf-brand, #1ed760); }
    .row-text { min-width: 0; flex: 1; }
    .row-name {
        font-size: var(--spf-text-md, 15px); font-weight: 700; color: #fff;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .row.active .row-name { color: var(--spf-brand, #1ed760); }
    .row-type {
        display: flex; align-items: center; gap: 6px;
        font-size: var(--spf-text-base, 13.5px); color: var(--spf-text-sub, #b3b3b3); margin-top: 2px;
    }
    .row-type svg { width: 14px; height: 14px; fill: currentColor; }
    .row-now { flex-shrink: 0; color: var(--spf-brand, #1ed760); display: flex; }
`;
