// Asset module declarations so importing images (the brand logo, etc.) type-checks
// under the project's tsconfig (which doesn't pull in vite/client's ambient types).
declare module '*.png' {
  const src: string
  export default src
}
declare module '*.svg' {
  const src: string
  export default src
}
