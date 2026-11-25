import stylistic from "@stylistic/eslint-plugin";
import prettierConfig from "eslint-config-prettier";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";
import { builtinRules } from "eslint/use-at-your-own-risk";

const eslintRecommendedRules = Object.freeze(
  Object.fromEntries(
    [...builtinRules.entries()]
      .filter(([, rule]) => rule.meta?.docs?.recommended === true)
      .map(([name]) => [name, "error"]),
  ),
);

const paddingLineRules = Object.freeze([
  { blankLine: "always", prev: "import", next: "*" },
  { blankLine: "any", prev: "import", next: "import" },
  { blankLine: "always", prev: ["function", "interface", "type"], next: "*" },
  { blankLine: "always", prev: "*", next: ["function", "interface", "type"] },
  { blankLine: "always", prev: "const", next: "*" },
  { blankLine: "any", prev: "const", next: "const" },
  { blankLine: "always", prev: "multiline-const", next: "*" },
  { blankLine: "always", prev: "*", next: "multiline-const" },
  { blankLine: "always", prev: "multiline-block-like", next: "*" },
  { blankLine: "always", prev: "*", next: "multiline-block-like" },
  { blankLine: "always", prev: "multiline-expression", next: "*" },
  { blankLine: "always", prev: "*", next: "multiline-expression" },
  { blankLine: "always", prev: "*", next: "return" },
]);

const sharedBestPracticeRules = Object.freeze({
  // Project best practices: immutability, Object Calisthenics, low cognitive complexity
  eqeqeq: ["error", "always"],
  "max-depth": ["error", 3],
  "no-constant-binary-expression": "error",
  "no-duplicate-imports": "error",
  "no-else-return": ["error", { allowElseIf: false }],
  "no-implicit-coercion": "error",
  "no-nested-ternary": "error",
  "no-param-reassign": "error",
  "no-restricted-syntax": [
    "error",
    {
      selector: "VariableDeclaration[kind='let']",
      message:
        "Avoid let; use const and immutable/declarative transforms instead.",
    },
    {
      selector: "IfStatement[alternate.type]",
      message: "Avoid else. Use a guard clause or extract a focused function.",
    },
  ],
  "no-self-compare": "error",
  "no-unneeded-ternary": "error",
  "no-unreachable-loop": "error",
  "no-unused-expressions": "error",
  "no-useless-catch": "error",
  "no-useless-concat": "error",
  "no-useless-rename": "error",
  "no-useless-return": "error",
  "no-var": "error",
  "object-shorthand": "error",
  "prefer-const": "error",
  "prefer-template": "error",
  // SonarJS: cognitive complexity, intra-file duplication, and dead-store checks
  "sonarjs/cognitive-complexity": ["error", 15],
  "sonarjs/no-all-duplicated-branches": "error",
  "sonarjs/no-collapsible-if": "error",
  "sonarjs/no-dead-store": "error",
  "sonarjs/no-duplicated-branches": "error",
  "sonarjs/no-identical-expressions": "error",
  "sonarjs/no-identical-functions": "error",
  "sonarjs/no-inverted-boolean-check": "error",
  "sonarjs/no-redundant-boolean": "error",
  "sonarjs/no-redundant-jump": "error",
  "sonarjs/no-unused-collection": "error",
  "sonarjs/prefer-immediate-return": "error",
  "sonarjs/prefer-single-boolean-return": "error",
  // Stylistic spacing alongside Prettier to prevent dense code walls
  "@stylistic/padding-line-between-statements": ["error", ...paddingLineRules],
});

export default [
  {
    ignores: [
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "vendor/**",
      "reports/**",
      "test-results/**",
      ".stryker-tmp/**",
    ],
  },
  {
    files: ["**/*.{js,mjs}"],
    plugins: { "@stylistic": stylistic, sonarjs },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      ...eslintRecommendedRules,
      ...sharedBestPracticeRules,
      "no-shadow": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  {
    files: ["**/*.ts"],
    plugins: { "@stylistic": stylistic, sonarjs },
    rules: {
      ...sharedBestPracticeRules,
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },
  {
    files: ["lib/**/*.ts"],
    rules: {
      complexity: ["error", 12],
    },
  },
  {
    files: ["tests/**/*.ts", "scripts/**/*.ts", "lib/**/*.test.ts"],
    rules: {
      "sonarjs/no-identical-functions": "off",
    },
  },
  {
    files: ["lib/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "max-lines": ["error", { max: 400 }],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      complexity: "off",
    },
  },
  // Disables ESLint rules that conflict with Prettier formatting
  prettierConfig,
  // Re-enable multi-line braces after prettierConfig for unambiguous wrapped blocks
  {
    files: ["**/*.{ts,js,mjs}"],
    rules: {
      curly: ["error", "multi-line"],
    },
  },
];
