module.exports = {
  extends: 'erb',
  plugins: ['@typescript-eslint'],
  rules: {
    // A temporary hack related to IDE not resolving correct package.json
    'import/no-extraneous-dependencies': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/jsx-filename-extension': 'off',
    'import/extensions': 'off',
    'import/no-unresolved': 'off',
    'import/no-import-module-exports': 'off',
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': 'error',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { ignoreRestSiblings: true },
    ], // `const { omit, ...rest }`
    // Conventions this codebase follows deliberately (the erb/airbnb defaults forbid them)
    'react/jsx-props-no-spreading': 'off',
    'react/require-default-props': 'off', // TS optional props, no defaultProps
    'import/prefer-default-export': 'off', // named exports throughout
    'no-void': 'off', // `void promise` marks fire-and-forget calls
    'no-plusplus': 'off',
    'no-nested-ternary': 'off',
    'no-restricted-syntax': ['error', 'LabeledStatement', 'WithStatement'], // allow for...of
    'no-undef': 'off', // TS checks globals (NodeJS, React namespaces); eslint's version false-positives on types
    'no-use-before-define': [
      'error',
      { functions: false, classes: false, variables: false },
    ],
    'consistent-return': 'off', // useEffect cleanups return conditionally
    'no-await-in-loop': 'off',
    'promise/always-return': 'off',
    'promise/catch-or-return': ['error', { allowThen: true }],
  },
  overrides: [
    {
      files: ['src/__tests__/**'],
      rules: {
        'global-require': 'off',
        'no-bitwise': 'off', // DOM compareDocumentPosition bit flags
        'class-methods-use-this': 'off', // mock classes
        'no-promise-executor-return': 'off',
        'promise/param-names': 'off',
      },
    },
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  settings: {
    'import/resolver': {
      // See https://github.com/benmosher/eslint-plugin-import/issues/1396#issuecomment-575727774 for line below
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        moduleDirectory: ['node_modules', 'src/'],
      },
      webpack: {
        config: require.resolve('./.erb/configs/webpack.config.eslint.ts'),
      },
      typescript: {},
    },
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts', '.tsx'],
    },
  },
};
