export interface AstEvent {
  type:
    | "file"
    | "class"
    | "function"
    | "call"
    | "method_call"
    | "import"
    | "api_contract";
  [key: string]: any;
}

export interface AstSink {
  emit(event: AstEvent): Promise<void> | void;
  flush(): Promise<void>;
}
