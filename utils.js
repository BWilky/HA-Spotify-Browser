export function msToTime(duration) {
    if (!duration) return '--:--';
    const seconds = Math.floor((duration / 1000) % 60);
    const minutes = Math.floor((duration / (1000 * 60)) % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

export function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

// ... existing exports ...

export function fireHaptic(hapticType) {
    const event = new CustomEvent("haptic", {
        detail: hapticType,
        bubbles: true,
        composed: true,
    });
    window.dispatchEvent(event);
}
