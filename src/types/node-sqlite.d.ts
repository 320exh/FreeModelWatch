declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string, options?: Record<string, unknown>);
    exec(sql: string): unknown;
    prepare(sql: string): StatementSync;
    close(): void;
  }
  export interface StatementSync {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  }
}
