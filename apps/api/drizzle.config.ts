import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./src/db/schema.ts", "./src/db/authSchema.ts"],
  out: "./migrations",
  dialect: "sqlite",
});
