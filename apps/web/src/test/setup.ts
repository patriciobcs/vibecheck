import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env.test", quiet: true, override: true });
