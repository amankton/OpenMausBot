// Webpack chunks are classic scripts. Keep esbuild's generated helpers private
// so loading another chunk cannot change an earlier module's helper bindings.
export const frontendMinifyOptions = Object.freeze({
  target: 'es2021', format: 'iife', minify: true, keepNames: true, legalComments: 'inline'
});
