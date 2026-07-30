// Vite replaces `import.meta.env.*` at build time; Jest runs under CommonJS and
// has no `import.meta`, so tests need it rewritten to a global Jest can seed
// (see src/test/setup.js).
module.exports = function importMetaEnvPlugin({ types: t }) {
  return {
    visitor: {
      MetaProperty(path) {
        if (path.node.meta.name === 'import' && path.node.property.name === 'meta') {
          path.replaceWith(t.memberExpression(t.identifier('globalThis'), t.identifier('__vite_import_meta__')))
        }
      },
    },
  }
}
