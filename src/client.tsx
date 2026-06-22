import type {FormEvent} from 'react';
import {useMemo, useState} from 'react';
import Layout from '@theme/Layout';
import {Lexer, type Token, type Tokens} from 'marked';

export type GeminiSearchClientConfig = {
  apiPath: string;
  title: string;
  subtitle: string;
  placeholder: string;
  suggestions: Array<{
    label?: string;
    question: string;
  }>;
  turnstileSiteKey?: string;
  turnstileAction?: string;
};

export type GeminiSearchPageProps = {
  config: GeminiSearchClientConfig;
};

type Citation = {
  title: string;
  url?: string;
  snippet?: string;
};

type ApiResponse = {
  answer?: string;
  citations?: Citation[];
  error?: string;
  captchaRequired?: boolean;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  isError?: boolean;
};

export default function GeminiSearchPage({config}: GeminiSearchPageProps) {
  const [conversationId, setConversationId] = useState(createConversationId);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const hasMessages = messages.length > 0;

  async function ask(event?: FormEvent<HTMLFormElement>, nextQuestion = question) {
    event?.preventDefault();
    const trimmedQuestion = nextQuestion.trim();
    if (!trimmedQuestion || isLoading) {
      return;
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedQuestion,
    };

    setMessages((current) => [...current, userMessage]);
    setQuestion('');
    setIsLoading(true);

    try {
      const response = await requestAnswer(config.apiPath, conversationId, trimmedQuestion);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response.answer || 'No answer was returned.',
          citations: response.citations || [],
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: error instanceof Error ? error.message : 'Gemini Search is unavailable right now.',
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function startNewConversation() {
    if (isLoading) {
      return;
    }
    setConversationId(createConversationId());
    setQuestion('');
    setMessages([]);
  }

  return (
    <Layout title={config.title} description={config.subtitle} noFooter>
      <main className="gemini-search-page">
        <section className="gemini-search-shell">
          <header className="gemini-search-header">
            <div>
              <h1>{config.title}</h1>
              <p>{config.subtitle}</p>
            </div>
            {hasMessages ? (
              <button type="button" className="gemini-search-secondary-button" onClick={startNewConversation}>
                New chat
              </button>
            ) : null}
          </header>

          {!hasMessages ? (
            <SuggestionGrid suggestions={config.suggestions} onSelect={(value) => ask(undefined, value)} />
          ) : null}

          <div className="gemini-search-messages" aria-live="polite">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`gemini-search-message gemini-search-message-${message.role}${message.isError ? ' is-error' : ''}`}
              >
                <div className="gemini-search-message-label">
                  {message.role === 'user' ? 'You' : 'AI'}
                </div>
                <MarkdownContent content={message.content} />
                {message.citations?.length ? <CitationList citations={message.citations} /> : null}
              </article>
            ))}
            {isLoading ? (
              <article className="gemini-search-message gemini-search-message-assistant">
                <div className="gemini-search-message-label">AI</div>
                <p>Searching the docs...</p>
              </article>
            ) : null}
          </div>

          <form className="gemini-search-form" onSubmit={ask}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={config.placeholder}
              rows={3}
              maxLength={1200}
            />
            <button type="submit" disabled={!question.trim() || isLoading}>
              Ask
            </button>
          </form>
        </section>
      </main>
    </Layout>
  );
}

function SuggestionGrid({
  suggestions,
  onSelect,
}: {
  suggestions: GeminiSearchClientConfig['suggestions'];
  onSelect: (question: string) => void;
}) {
  if (!suggestions.length) {
    return null;
  }

  return (
    <div className="gemini-search-suggestions">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.question}
          type="button"
          className="gemini-search-suggestion"
          onClick={() => onSelect(suggestion.question)}
        >
          {suggestion.label ? <span>{suggestion.label}</span> : null}
          <strong>{suggestion.question}</strong>
        </button>
      ))}
    </div>
  );
}

async function requestAnswer(apiPath: string, conversationId: string, question: string): Promise<ApiResponse> {
  const response = await fetch(apiPath, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({conversationId, question}),
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json() as ApiResponse
    : {};

  if (response.status === 403 && data.captchaRequired) {
    throw new Error('Verification is required. Configure Turnstile client support before enabling captcha.');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Gemini Search is unavailable right now.');
  }

  return data;
}

function CitationList({citations}: {citations: Citation[]}) {
  return (
    <div className="gemini-search-citations">
      <h2>References</h2>
      <ol>
        {citations.map((citation, index) => (
          <li key={`${citation.url || citation.title}-${index}`}>
            {citation.url ? (
              <a href={citation.url} target="_blank" rel="noreferrer">
                {citation.title}
              </a>
            ) : (
              <span>{citation.title}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function MarkdownContent({content}: {content: string}) {
  const tokens = useMemo(() => Lexer.lex(content), [content]);
  return <div className="gemini-search-markdown">{tokens.map((token, index) => renderMarkdownBlock(token, index))}</div>;
}

function renderMarkdownBlock(token: Token, key: number | string) {
  if (token.type === 'heading') {
    const heading = token as Tokens.Heading;
    const HeadingTag = `h${Math.min(heading.depth + 1, 4)}` as 'h2' | 'h3' | 'h4';
    return <HeadingTag key={key}>{heading.text}</HeadingTag>;
  }

  if (token.type === 'paragraph') {
    return <p key={key}>{(token as Tokens.Paragraph).text}</p>;
  }

  if (token.type === 'list') {
    const list = token as Tokens.List;
    const Tag = list.ordered ? 'ol' : 'ul';
    return (
      <Tag key={key}>
        {list.items.map((item, itemIndex) => (
          <li key={itemIndex}>{item.text}</li>
        ))}
      </Tag>
    );
  }

  if (token.type === 'code') {
    return <pre key={key}><code>{(token as Tokens.Code).text}</code></pre>;
  }

  if (token.type === 'space') {
    return null;
  }

  return <p key={key}>{'text' in token ? String(token.text) : ''}</p>;
}

function createConversationId() {
  const random = Math.random().toString(36).slice(2, 12);
  return `gs-${Date.now().toString(36)}-${random}`;
}

