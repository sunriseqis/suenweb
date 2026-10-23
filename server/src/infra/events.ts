import { EventEmitter } from 'node:events';

export type AppEvent = 'links-changed' | 'groups-changed';

/** 进程内事件总线：写操作完成后广播，SSE 把变化推给网页与插件 */
export class AppEvents {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit(event: AppEvent, payload: unknown = {}): void {
    this.emitter.emit(event, payload);
  }

  on(event: AppEvent, listener: (payload: unknown) => void): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  listenerCount(event: AppEvent): number {
    return this.emitter.listenerCount(event);
  }
}
