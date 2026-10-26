import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env.ts";

let client: SupabaseClient | null = null;

// Клиент Supabase с service role: обходит RLS, только для кода функций.
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY облако передаёт функциям само.
export function getDb(): SupabaseClient {
  if (!client) {
    client = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return client;
}
