import { Result, URI } from "@adviser/cement";
import { SysFileSystem } from "@fireproof/core";

export interface DBConnection {
  connect(): Promise<void>;
  fs(): Promise<SysFileSystem>;
  readonly opts: SQLOpts;
}

export interface SQLRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SQLStore<IType, KType, OType = IType[]> {
  readonly dbConn: DBConnection;
  start(url: URI): Promise<URI>;
  insert(url: URI, ose: IType): Promise<SQLRunResult>;
  select(url: URI, car: KType): Promise<OType>;
  delete(url: URI, car: KType): Promise<SQLRunResult>;
  close(url: URI): Promise<Result<void>>;
  destroy(url: URI): Promise<Result<void>>;
}

export interface SQLTableNames {
  readonly data: string;
  readonly meta: string;
  readonly wal: string;
}

export const DefaultSQLTableNames: SQLTableNames = {
  data: "Datas",
  meta: "Metas",
  wal: "Wals",
};

export interface SQLGestalt {
  readonly flavor: "sqlite" | "mysql" | "postgres";
  readonly version?: string;
  readonly taste?: string; // bs3(better-sqlite3) - nsw(node-sqlite3-wasm)
}

export interface SQLOpts {
  readonly url: URI;
  readonly sqlGestalt: SQLGestalt;
  readonly tableNames: SQLTableNames;
}

export interface WalKey {
  readonly name: string;
  readonly branch: string;
}

export interface WalRecord extends WalKey {
  readonly state: Uint8Array;
  readonly updated_at: Date;
}

export type WalSQLStore = SQLStore<WalRecord, WalKey>;

export interface MetaType {
  readonly name: string;
  readonly branch: string;
  readonly meta: Uint8Array;
}

export interface MetaRecordKey {
  readonly name: string;
  readonly branch: string;
}

export interface MetaRecord extends MetaRecordKey {
  readonly meta: Uint8Array;
  readonly updated_at: Date;
}

export type MetaSQLStore = SQLStore<MetaRecord, MetaRecordKey>;

export interface DataRecord {
  readonly name: string;
  readonly car: string;
  readonly data: Uint8Array;
  readonly updated_at: Date;
}

export type DataSQLStore = SQLStore<DataRecord, string>;
