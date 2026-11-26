/**
 * Scroll behaviour of a "hero page" (the playlist/album/Liked Songs view and
 * the artist view): a scroll container that opens with a hero banner and
 * drives the app header while it scrolls. Pages without a hero use it too
 * (the "See All" section page: `heroClass: null`, a constant `fade`).
 *
 *   - rAF-coalesced scroll handling (one frame of work per burst of events)
 *   - decorative parallax: the hero image stretches on over-scroll and,
 *     optionally, the hero text block fades/shrinks as it scrolls away
 *   - the app-header fade: `{ alpha, textAlpha, title }` dispatched from the
 *     host as a bubbling, composed `header-scroll` event
 *   - near-bottom detection (infinite scroll), via a host callback
 *
 * Host wiring:
 *   this._hero = new HeroScrollController(this, {
 *       getTitle: () => this.data?.name || '',
 *       heroImage: '.hero-banner .hero-bg img',
 *       ...
 *   });
 *   scroll container: class="main-scroll-container has-hero" @scroll=${this._hero.onScroll}
 *   updateHeaderState() { this._hero.updateHeaderState(); }   // parent: page shown again
 *   this._hero.syncSoon()   // optional: re-report after the current task (e.g. after each update)
 *   this._hero.sync()       // optional: re-report now (skipped while unchanged, with dedupe)
 *
 * Options (what differs between the pages):
 *   getTitle        header title (required).
 *   heroImage       selector of the hero <img> that stretches on over-scroll.
 *   heroContent     selector of the hero text block that fades and shrinks as
 *                   the page scrolls (null: none).
 *   isLite          () => true on the low-power profile: the parallax is
 *                   skipped (the header and near-bottom still run).
 *   fade            fixed header thresholds: { alphaEnd = 200, textStart, textSpan }
 *                   (see fixedHeaderFade), or a function scrollTop =>
 *                   { alpha, textAlpha }.
 *   mobileFade      { query, heroBanner }: while `query` matches, the fade is
 *                   tied to the height of the `heroBanner` element instead
 *                   (see heroHeightHeaderFade). null: always `fade`.
 *   dedupe          skip a header dispatch identical to the previous one,
 *                   unless forced (updateHeaderState forces it: another page
 *                   may have changed the app header in between).
 *   onNearBottom    called on every scroll frame that ends within
 *                   `nearBottom` px of the end of the content.
 *   heroClass       class the scroll container must carry to drive the header,
 *                   fade the hero text and load more (default HERO_PAGE_CLASS,
 *                   which the playlist view's edit-mode container lacks).
 *                   null: any container does (a page without a hero).
 *
 * Rules shared by all pages: only a container carrying `heroClass` drives
 * the header (and fades the hero text, and loads more); nothing is dispatched
 * while the container has no layout box (a cached page hidden by the router
 * still updates, and its scrollTop reads 0 then). A pending frame and pending
 * syncSoon() reports are cancelled when the host disconnects.
 */

/** Class on the scroll container of a page that has a hero (edit mode has none). */
export const HERO_PAGE_CLASS = 'has-hero';
/** Desktop hero height: the over-scroll stretch reference, and the mobile fallback. */
const HERO_HEIGHT = 375;
const SCROLL_CONTAINER = '.main-scroll-container';

/**
 * Header fade with fixed thresholds: the header background is opaque at
 * `alphaEnd` px, the title fades in over [textStart, textStart + textSpan].
 * alpha is not clamped below 0 (it goes negative on over-scroll), as the
 * pages always had it.
 */
export function fixedHeaderFade(scrollTop, { alphaEnd = 200, textStart, textSpan }) {
    return {
        alpha: Math.min(scrollTop / alphaEnd, 1),
        textAlpha: Math.max(0, Math.min((scrollTop - textStart) / textSpan, 1)),
    };
}

/**
 * Header fade tied to the hero's height (mobile: the hero is tall and
 * centred, so a fixed threshold would fade the header in while the hero is
 * still fully visible). The header appears as the hero scrolls out under it.
 */
export function heroHeightHeaderFade(scrollTop, heroHeight) {
    const fadeEnd = Math.max(heroHeight - 100, 1); // ~header height below the hero
    const fadeStart = Math.max(fadeEnd - 80, 0);
    return {
        alpha: Math.max(0, Math.min((scrollTop - fadeStart) / (fadeEnd - fadeStart), 1)),
        textAlpha: Math.max(0, Math.min((scrollTop - fadeEnd) / 50, 1)),
    };
}

export class HeroScrollController {
    constructor(host, {
        getTitle,
        heroImage = null,
        heroContent = null,
        isLite = () => false,
        fade,
        mobileFade = null,
        dedupe = false,
        onNearBottom = null,
        nearBottom = 200,
        heroClass = HERO_PAGE_CLASS,
    }) {
        this.host = host;
        this._getTitle = getTitle;
        this._heroImage = heroImage;
        this._heroContent = heroContent;
        this._isLite = isLite;
        this._fade = fade;
        this._mobileFade = mobileFade;
        // Cached once: matchMedia() re-parses the query on every call.
        this._mql = mobileFade ? window.matchMedia(mobileFade.query) : null;
        this._dedupe = dedupe;
        this._onNearBottom = onNearBottom;
        this._nearBottom = nearBottom;
        this._heroClass = heroClass;
        this._raf = null;
        this._target = null;
        this._last = null;        // last dispatched { alpha, textAlpha, title }
        this._els = {};           // cached element refs, re-queried once detached
        this._syncTimers = new Set();
        // Bound: used directly as the container's @scroll listener.
        this.onScroll = this.onScroll.bind(this);
        host.addController(this);
    }

    hostDisconnected() {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
        this._syncTimers.forEach(clearTimeout);
        this._syncTimers.clear();
    }

    /** @scroll listener: coalesce a burst of scroll events into one frame. */
    onScroll(e) {
        // Scroll does not bubble, so this is the container the listener is on.
        this._target = e.currentTarget || e.target;
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => {
            this._raf = null;
            this._apply(this._target);
        });
    }

    /** Report the header state now, even if unchanged (the page is shown again). */
    updateHeaderState() {
        this._syncHeader(this._find('container', SCROLL_CONTAINER), true);
    }

    /** Report the header state now; with `dedupe`, only if it changed. */
    sync() {
        this._syncHeader(this._find('container', SCROLL_CONTAINER), false);
    }

    /** Report the header state once the current task is done (after a host update). */
    syncSoon() {
        const id = setTimeout(() => {
            this._syncTimers.delete(id);
            this._syncHeader(this._find('container', SCROLL_CONTAINER), false);
        }, 0);
        this._syncTimers.add(id);
    }

    _find(key, selector) {
        let el = this._els[key];
        if (!el || !el.isConnected) el = this._els[key] = this.host.shadowRoot?.querySelector(selector);
        return el;
    }

    _apply(target) {
        if (!target) return;
        const scrollTop = target.scrollTop;
        const isHero = this._isHeroPage(target);

        // Decorative parallax (stretchy art + hero fade/scale). Skipped on the
        // low-power profile — it's the heaviest per-frame work here.
        if (!this._isLite()) {
            const heroImg = this._heroImage ? this._find('image', this._heroImage) : null;
            if (heroImg) {
                if (scrollTop < 0) {
                    const scale = 1 - scrollTop / HERO_HEIGHT;
                    heroImg.style.transform = `translateY(${scrollTop}px) scale(${scale})`;
                    heroImg.style.transformOrigin = 'top center';
                } else {
                    heroImg.style.transform = '';
                    heroImg.style.transformOrigin = '';
                }
            }

            if (isHero && this._heroContent) {
                const heroContent = this._find('content', this._heroContent);
                if (heroContent) {
                    heroContent.style.opacity = Math.max(0, 1 - (scrollTop / 200));
                    const scale = 1 - (scrollTop / 1000);
                    if (scale > 0.8) {
                        heroContent.style.transform = `scale(${scale})`;
                        heroContent.style.transformOrigin = 'center center';
                    }
                }
            }
        }

        if (isHero) {
            this._syncHeader(target, false);

            if (this._onNearBottom && scrollTop + target.clientHeight >= target.scrollHeight - this._nearBottom) {
                this._onNearBottom();
            }
        }
    }

    _isHeroPage(container) {
        return this._heroClass === null || container.classList.contains(this._heroClass);
    }

    /** The header fade for `scrollTop`, by the rules this page was given. */
    _headerFade(scrollTop) {
        if (this._mql && this._mql.matches) {
            const banner = this._find('banner', this._mobileFade.heroBanner);
            return heroHeightHeaderFade(scrollTop, banner ? banner.offsetHeight : HERO_HEIGHT);
        }
        if (typeof this._fade === 'function') return this._fade(scrollTop);
        return fixedHeaderFade(scrollTop, this._fade);
    }

    _syncHeader(container, force) {
        if (!container || !this._isHeroPage(container)) return;
        // A cached page hidden by the router (display:none on an ancestor) still
        // updates on track changes; it has no layout box then, and its scrollTop
        // reads 0. Never drive the app header from it.
        if (container.getClientRects().length === 0) return;
        const { alpha, textAlpha } = this._headerFade(container.scrollTop);
        const title = this._getTitle();
        const last = this._last;
        if (this._dedupe && !force && last
            && last.alpha === alpha && last.textAlpha === textAlpha && last.title === title) return;
        this._last = { alpha, textAlpha, title };
        this.host.dispatchEvent(new CustomEvent('header-scroll', {
            detail: { alpha, textAlpha, title },
            bubbles: true,
            composed: true
        }));
    }
}
