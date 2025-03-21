// Generated by Wrangler on Fri Aug 16 2024 13:55:06 GMT+0200 (Central European Summer Time)
// by running `wrangler types`

import type { KVNamespace, R2Bucket } from "@cloudflare/workers-types";
import { type Fireproof } from "./src/index.js";

export interface Env {
  bucket: R2Bucket;
  kv_store: KVNamespace;

  ACCESS_KEY_ID: string;
  // ACCOUNT_ID: string;
  // BUCKET_NAME: string;
  SECRET_ACCESS_KEY: string;

  STORAGE_URL: string;
  CLOUDFLARE_API_TOKEN: string;
  EMAIL: string;
  FIREPROOF_SERVICE_PRIVATE_KEY: string;
  POSTMARK_TOKEN: string;
  SERVICE_ID: string;

  Fireproof: DurableObjectNamespace<Fireproof>;
}
