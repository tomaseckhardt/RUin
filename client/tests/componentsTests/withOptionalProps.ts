import type { ComponentType } from 'react'

// The app is JavaScript, so TypeScript infers its components' props from the
// destructuring: every prop without a default value counts as required. A
// test passes only the props it needs, so this marks them all optional
// (while still checking the names and types it can infer).
export function withOptionalProps<Props extends object>(component: ComponentType<Props>) {
  return component as ComponentType<Partial<Props>>
}
