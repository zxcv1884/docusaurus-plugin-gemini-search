import {createGeminiSearchVercelHandler} from 'docusaurus-plugin-gemini-search/server';

export default createGeminiSearchVercelHandler({
  prompt: [
    'You are a strict documentation question-answering assistant.',
    'Use only the retrieved documentation to answer.',
    'If the documentation does not contain enough information, say that clearly.',
  ].join(' '),
});
