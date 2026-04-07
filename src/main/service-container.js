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
        this._services.set(name, instance);
        return this;
    }

    get(name) {
        const svc = this._services.get(name);
        if (!svc) throw new Error(`[ServiceContainer] Service "${name}" not registered`);
        return svc;
    }

    has(name) {
        return this._services.has(name);
    }

    /**
     * Get a service or return null if not registered.
     * Useful for optional services.
     */
    optional(name) {
        return this._services.get(name) || null;
    }
}

module.exports = ServiceContainer;
