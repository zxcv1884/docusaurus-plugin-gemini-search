import {createGeminiSearchFetchHandler} from 'docusaurus-plugin-gemini-search/fetch';

export const POST = createGeminiSearchFetchHandler({
  prompt: [
    'You are a strict documentation question-answering assistant.',
    'Use only the retrieved documentation to answer.',
    'If the documentation does not contain enough information, say that clearly.',
  ].join(' '),
});
