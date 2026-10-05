// ESLint 9 flat config: TypeScript (typescript-eslint's recommended rules)
// and React hooks for the renderer, Node globals for the Electron main
// process and build scripts.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist-electron",
      "build",
      "release",
      "models",
      "venvs",
      "servers",
      "kwesi.docs",
      ".claude",
      "**/*.tsbuildinfo",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ["electron/**/*.ts", "scripts/**/*.{js,mjs}", "*.config.{ts,js,mjs}"],
    languageOptions: { globals: globals.node },
  },
);
