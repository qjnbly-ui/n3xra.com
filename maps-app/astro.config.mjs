import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  base: "/maps",
  integrations: [react()],
  output: "static",
  outDir: "../maps",
});
