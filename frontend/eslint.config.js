import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * The `no-restricted-imports` blocks below are the enforcement mechanism for
 * PLAN.md's architecture rules. They are not style preferences — they are what
 * keeps "components never call Wails" and "business logic lives in services"
 * true after six months of feature work, and what keeps a future Wails v2 → v3
 * migration contained to one directory.
 */
export default tseslint.config(
  { ignores: ['dist', 'wailsjs', 'node_modules', 'coverage'] },

  js.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    // Type-aware rules are scoped to TS files only — applying them globally
    // makes ESLint try to type-check its own JS config file and crash.
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Wails RPC returns promises everywhere; unhandled ones hide real errors.
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  // --- architecture rule 1: only services/wails may touch the Wails bridge ---
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/services/wails/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/wailsjs/**', '@/wailsjs/**', '../../wailsjs/**'],
              message:
                'Import generated Wails bindings only in src/services/wails/. Everything else goes through a typed service wrapper (PLAN.md §1.1, §4.1).',
            },
          ],
        },
      ],
    },
  },

  // --- architecture rule 2: components stay presentational ---
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/layouts/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/wailsjs/**', '@/services/git/**', '@/services/db/**'],
              message:
                'Components and layouts are presentational. Git and DB access belongs in features/ or hooks/, never here (PLAN.md §React Component Rules).',
            },
          ],
        },
      ],
    },
  },

  // --- architecture rule 3: the git layer is framework-free ---
  {
    files: ['src/services/git/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                'services/git must stay React-free so parsers are unit-testable in isolation (PLAN.md §5).',
            },
            {
              name: 'zustand',
              message: 'services/git must not depend on stores; data flows the other way.',
            },
          ],
        },
      ],
    },
  },

  // --- tests may reach anywhere ---
  {
    files: ['**/*.test.{ts,tsx}', 'vitest.setup.ts', '**/__fixtures__/**'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  {
    files: ['*.config.{ts,js}', 'vitest.setup.ts'],
    languageOptions: { globals: globals.node },
  },

  // Plain JS (this config file) is not part of the TS project.
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
