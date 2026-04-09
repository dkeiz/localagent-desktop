/**
 * ServiceContainer — Simple dependency injection container.
 * 
 * Replaces the 22-parameter function calls with a single container object.
 * All services register here during bootstrap and are accessible by name.
 */
class ServiceContainer {
    constructor() {
        this._services = new Map();
    }

    register(name, instance) {
        if (this._services.has(name)) {
            throw new Error(`[ServiceContainer] Service "${name}" is already registered`);
        }
        this._services.set(name, instance);
        return this;
    }

    replace(name, instance) {
        this._services.set(name, instance);
        return this;
    }

    get(name) {
        if (!this._services.has(name)) {
            throw new Error(`[ServiceContainer] Service "${name}" not registered`);
        }
        return this._services.get(name);
    }

    has(name) {
        return this._services.has(name);
    }

    /**
     * Get a service or return null if not registered.
     * Useful for optional services.
     */
    optional(name) {
        return this._services.has(name) ? this._services.get(name) : null;
    }

    keys() {
        return Array.from(this._services.keys()).sort();
    }
}

module.exports = ServiceContainer;
