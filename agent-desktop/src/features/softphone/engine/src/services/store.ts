/** Minimal observable store. Listeners receive the full new state after every change. */
export type Listener<T> = (state: T, previous: T) => void;

export class Store<T extends object> {
  private state: T;
  private readonly listeners = new Set<Listener<T>>();

  constructor(initial: T) {
    this.state = initial;
  }

  get(): T {
    return this.state;
  }

  update(change: Partial<T> | ((current: T) => Partial<T>)): void {
    const previous = this.state;
    const partial = typeof change === 'function' ? change(previous) : change;
    this.state = { ...previous, ...partial };
    for (const listener of this.listeners) listener(this.state, previous);
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
