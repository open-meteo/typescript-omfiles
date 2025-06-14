import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';
const isProduction = process.env.NODE_ENV === 'production';

// Common configuration
const commonConfig = {
  input: 'src/index.ts',
  external: [
    '@openmeteo/file-format-wasm',
    '@aws-sdk/client-s3'
  ]
};

export default [
  // ESM build
  {
    ...commonConfig,
    output: {
      file: 'dist/index.js',
      format: 'esm',
      sourcemap: true
    },
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' }),
      isProduction && terser()
    ]
  },

  // CJS build (for Node.js)
  {
    ...commonConfig,
    output: {
      file: 'dist/index.cjs',
      format: 'cjs',
      sourcemap: true
    },
    plugins: [
      resolve({ browser: false }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' }),
      isProduction && terser()
    ]
  },

  // Type definitions
  {
    ...commonConfig,
    output: {
      file: 'dist/index.d.ts',
      format: 'es'
    },
    plugins: [dts()]
  }
];
