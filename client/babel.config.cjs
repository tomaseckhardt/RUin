module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'automatic' }],
    // The tests are TypeScript; Babel only strips the types (npm run typecheck checks them).
    '@babel/preset-typescript',
  ],
  plugins: ['./babel-plugin-import-meta-env.cjs'],
}
