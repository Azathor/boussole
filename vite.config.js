import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ⚠️ Remplace "boussole" ci-dessous par le nom EXACT de ton dépôt GitHub.
// Exemple : si ton dépôt s'appelle "mon-projet", mets base: "/mon-projet/"
export default defineConfig({
  plugins: [react()],
  base: "/boussole/",
});
