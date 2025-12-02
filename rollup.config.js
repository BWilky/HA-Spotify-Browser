import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

export default {
  // Point this to your main input file
  input: 'index.js', 
  output: {
    // This is the file HACS will serve
    file: 'dist/spotify-browser.js', 
    format: 'es', // 'es' module is standard for HA cards
  },
  plugins: [
    resolve(), // Allows you to import files/node_modules
    terser()   // Minifies the code (makes it smaller)
  ]
};
