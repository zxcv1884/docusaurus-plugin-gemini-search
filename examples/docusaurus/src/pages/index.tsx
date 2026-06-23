import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

export default function Home() {
  return (
    <Layout title="Gemini Search Example" description="Docusaurus Gemini Search example">
      <main style={{maxWidth: 860, margin: '0 auto', padding: '64px 24px'}}>
        <h1>Gemini Search Example</h1>
        <p>
          This example shows how to add a Gemini-powered AI assistant to a Docusaurus site.
        </p>
        <p>
          <Link className="button button--primary" to="/ask-ai">
            Open Ask AI
          </Link>
          {' '}
          <Link className="button button--secondary" to="/docs/intro">
            Read example docs
          </Link>
        </p>
      </main>
    </Layout>
  );
}

