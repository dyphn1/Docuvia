export interface AstEvent {
  type: "file" | "class" | "function" | "call";
  [key: string]: any;
}

export interface AstSink {
  emit(event: AstEvent): Promise<void> | void;
  flush(): Promise<void>;
}
