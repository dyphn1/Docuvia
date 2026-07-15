import { AstEventType } from "./constants/ast-event-constants.js";

export interface AstEvent {
  type: AstEventType;
  [key: string]: any;
}

export interface AstSink {
  emit(event: AstEvent): Promise<void> | void;
  flush(): Promise<void>;
}
