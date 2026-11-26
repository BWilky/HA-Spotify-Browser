// Load Lit components under `node --test` without rendering them: the
// lit-env globals plus a customElements registry that only records each
// defined class. A test makes a bare instance with
// `Object.create(definedElement('x').prototype)` (no constructor, no Lit
// update cycle), sets the fields a method reads and calls the method.
// Import this module BEFORE the component modules.
import './lit-env.js';

const registry = new Map();
globalThis.customElements ??= {
    define: (name, cls) => { registry.set(name, cls); },
    get: (name) => registry.get(name),
};

/** The class a module registered under `name`. */
export function definedElement(name) {
    const cls = globalThis.customElements.get(name);
    if (!cls) throw new Error(`<${name}> was not defined`);
    return cls;
}
