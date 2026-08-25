declare module "react" {
  export type ReactNode =
    | string
    | number
    | boolean
    | null
    | undefined
    | ReactElement
    | readonly ReactNode[];

  export interface ReactElement {
    readonly type: unknown;
    readonly props: Record<string, unknown>;
    readonly key: string | number | null;
  }

  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useCallback<T extends (...args: readonly unknown[]) => unknown>(callback: T, deps: readonly unknown[]): T;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;

  export interface ChangeEvent<T = Element> {
    readonly target: T;
  }

  export interface MouseEvent<T = Element> {
    readonly target: T;
  }
}

declare module "react/jsx-runtime" {
  import type { ReactElement } from "react";
  export function jsx(type: unknown, props: Record<string, unknown>, key?: string): ReactElement;
  export function jsxs(type: unknown, props: Record<string, unknown>, key?: string): ReactElement;
}

declare module "react-dom/client" {
  import type { ReactElement } from "react";
  export interface Root {
    render(children: ReactElement): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}

declare namespace JSX {
  interface IntrinsicElements {
    readonly [elemName: string]: Record<string, unknown>;
  }
  type Element = import("react").ReactElement;
}
