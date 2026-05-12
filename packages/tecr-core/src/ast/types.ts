export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'method'
  | 'enum'
  | 'variable'
  | 'other';

export interface SymbolRecord {
  name: string;
  kind: SymbolKind;
  /** First line of the declaration — signature without the body. */
  signature: string;
  /** 1-based line number in the source file. */
  line: number;
  exported: boolean;
}

export interface FileRecord {
  /** Absolute path on disk. */
  path: string;
  symbols: SymbolRecord[];
  /**
   * Absolute paths of files this file imports.
   * Only includes paths that resolve within the workspace.
   */
  imports: string[];
}
