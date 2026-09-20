import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Private media storage (Supabase Storage). Only the server holds the service key;
 * viewers receive short-lived signed URLs that must never be copied into permanent records.
 */
export type StorageClient = {
  ensureBucket(): Promise<void>;
  upload(path: string, body: Blob | Uint8Array, contentType: string): Promise<{ path: string }>;
  download(path: string): Promise<Blob>;
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
  remove(paths: string[]): Promise<void>;
};

export function createSupabaseStorage(): StorageClient {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET: bucket } = env();
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  return {
    async ensureBucket() {
      const { data } = await client.storage.getBucket(bucket);
      if (data) return;
      const { error } = await client.storage.createBucket(bucket, { public: false });
      if (error && !/already exists/i.test(error.message)) throw error;
    },
    async upload(path, body, contentType) {
      const { error } = await client.storage
        .from(bucket)
        .upload(path, body, { contentType, upsert: true });
      if (error) throw new Error(`storage upload failed: ${error.message}`);
      return { path };
    },
    async download(path) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data)
        throw new Error(`storage download failed: ${error?.message ?? "no data"}`);
      return data;
    },
    async signedUrl(path, expiresInSeconds) {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(path, expiresInSeconds);
      if (error || !data) throw new Error(`signed url failed: ${error?.message ?? "no data"}`);
      return data.signedUrl;
    },
    async remove(paths) {
      const { error } = await client.storage.from(bucket).remove(paths);
      if (error) throw new Error(`storage remove failed: ${error.message}`);
    },
  };
}

let cached: StorageClient | null = null;
export function storage(): StorageClient {
  if (!cached) cached = createSupabaseStorage();
  return cached;
}
