/** Metro resolves an image import to a number; TypeScript needs telling. */
declare module '*.png' {
  const source: number;
  export default source;
}
