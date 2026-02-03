import eslintJs from "@eslint/js";
import globals from "globals";

export default [{
    files: ["**/*.{js,ts,mjs,mts,cjs,cts,jsx,tsx}"],
    ignores: ["**/dist/**"],

    languageOptions: {
        globals: {
            ...globals.node,
            ...globals.commonjs,
            ...globals.jest,
        },

        ecmaVersion: 12,
        sourceType: "commonjs",
    },

    rules: {
        ...eslintJs.configs.recommended.rules,
    },
}];