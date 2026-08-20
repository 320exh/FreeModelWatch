import { config } from "dotenv";

export function loadEnv() {
  config({ path: ".env.local" });
}
