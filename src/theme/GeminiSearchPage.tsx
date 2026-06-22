import Layout from '@theme/Layout';
import GeminiSearchPanel, {type GeminiSearchClientConfig} from '../client.js';

export default function GeminiSearchPage({config}: {config: GeminiSearchClientConfig}) {
  return (
    <Layout title={config.title} description={config.subtitle} noFooter>
      <GeminiSearchPanel config={config} />
    </Layout>
  );
}
