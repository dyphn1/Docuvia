export class Container {
  private services = new Map<symbol, any>();

  register<T>(token: symbol, service: T) {
    this.services.set(token, service);
  }

  resolve<T>(token: symbol): T {
    const service = this.services.get(token);
    if (!service) {
      throw new Error(`Service not found for token: ${String(token)}`);
    }
    return service;
  }
}

export const container = new Container();
