declare module '@theme/Layout' {
  import type {ReactNode} from 'react';

  export default function Layout(props: {
    title?: string;
    description?: string;
    noFooter?: boolean;
    children?: ReactNode;
  }): JSX.Element;
}

