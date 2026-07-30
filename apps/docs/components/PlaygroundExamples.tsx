import type { ReactElement } from 'react';
import { useState } from 'react';
import styles from './PlaygroundExamples.module.css';

type ExampleId = 'react' | 'static' | 'marketplace';

interface ExampleMeta {
  id: ExampleId;
  label: string;
  title: string;
  description: string;
  sdk: string;
  devCommand: string;
  docsAnchor: string;
  path: string;
  devUrl: string;
}

const useDevServers = process.env.NEXT_PUBLIC_EXAMPLE_DEV_MODE === 'true';

const EXAMPLES: ExampleMeta[] = [
  {
    id: 'react',
    label: 'React / Next.js',
    title: 'React Storefront',
    description:
      'A minimal Next.js product page that opens the checkout modal with @pacto-connect/react.',
    sdk: '@pacto-connect/react',
    devCommand: 'cd apps/docs/examples/react-storefront && npm run dev',
    docsAnchor: '#react-storefront',
    path: '/examples/react/',
    devUrl: 'http://localhost:3201/examples/react/',
  },
  {
    id: 'static',
    label: 'Static HTML',
    title: 'Static Storefront',
    description:
      'Plain HTML and JavaScript using pacto.mount() from @pacto-connect/elements — no UI framework.',
    sdk: '@pacto-connect/elements',
    devCommand: 'cd apps/docs/examples/static-storefront && npm run dev',
    docsAnchor: '#static-storefront',
    path: '/examples/static/',
    devUrl: 'http://localhost:3202/examples/static/',
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    title: 'Marketplace Storefront',
    description:
      'Multi-product grid with two distinct listings sharing one PactoCheckout integration.',
    sdk: '@pacto-connect/react',
    devCommand: 'cd apps/docs/examples/marketplace && npm run dev',
    docsAnchor: '#marketplace',
    path: '/examples/marketplace/',
    devUrl: 'http://localhost:3203/examples/marketplace/',
  },
];

function exampleSrc(example: ExampleMeta): string {
  return useDevServers ? example.devUrl : example.path;
}

export function PlaygroundExamples(): ReactElement {
  const [active, setActive] = useState<ExampleId>('react');
  const example = EXAMPLES.find((e) => e.id === active) ?? EXAMPLES[0]!;

  return (
    <div className={styles.exampleRoot}>
      <aside className={styles.sidebar}>
        <h3 className={styles.sidebarTitle}>{example.title}</h3>
        <p className={styles.sidebarDesc}>{example.description}</p>

        <div className={styles.metaBlock}>
          <span className={styles.metaLabel}>SDK</span>
          <code className={styles.metaValue}>{example.sdk}</code>
        </div>

        <div className={styles.metaBlock}>
          <span className={styles.metaLabel}>Run locally</span>
          <code className={styles.metaValue}>{example.devCommand}</code>
        </div>

        <a className={styles.link} href={`/examples${example.docsAnchor}`}>
          View source walkthrough →
        </a>

        {useDevServers && (
          <p className={styles.hint}>
            Dev mode: iframe points at local example server. Run the command above in a separate
            terminal.
          </p>
        )}
        {!useDevServers && (
          <p className={styles.hint}>
            Examples are built into this site. Rebuild with <code>npm run build:examples</code> from{' '}
            <code>apps/docs</code> after editing source.
          </p>
        )}
      </aside>

      <div className={styles.preview}>
        <div className={styles.subTabs}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.id}
              type="button"
              className={styles.subTab + (active === ex.id ? ' ' + styles.subTabActive : '')}
              onClick={() => setActive(ex.id)}
            >
              {ex.label}
            </button>
          ))}
        </div>

        <div className={styles.iframeWrap}>
          <iframe
            key={example.id + (useDevServers ? '-dev' : '-static')}
            title={example.title}
            className={styles.iframe}
            src={exampleSrc(example)}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      </div>
    </div>
  );
}
