import type {FormEvent} from 'react';
import {useMemo, useState} from 'react';
import Layout from '@theme/Layout';
import {Lexer, type Token, type Tokens} from 'marked';
import styles from './ask-ai.module.css';

type Citation = {
  title: string;
  url?: string;
  snippet?: string;
};

type ApiResponse = {
  answer?: string;
  citations?: Citation[];
  interactionId?: string;
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

const apiPath = '/api/gemini-search';
const suggestions = [
  {
    label: 'Docs',
    question: 'What can I find in these docs?',
  },
];

export default function AskAiPage() {
  const [previousInteractionId, setPreviousInteractionId] = useState<string>();
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

    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        content: trimmedQuestion,
      },
    ]);
    setQuestion('');
    setIsLoading(true);

    try {
      const response = await requestAnswer({
        previousInteractionId,
        question: trimmedQuestion,
      });
      setPreviousInteractionId(response.interactionId);
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
    setPreviousInteractionId(undefined);
    setQuestion('');
    setMessages([]);
  }

  return (
    <Layout title="Ask AI" description="Ask this documentation a question." noFooter>
      <main className={styles.page}>
        <section className={styles.shell}>
          <header className={styles.header}>
            <div>
              <h1>Ask AI</h1>
              <p>Ask this documentation a question.</p>
            </div>
            {hasMessages ? (
              <button type="button" className={styles.secondaryButton} onClick={startNewConversation}>
                New chat
              </button>
            ) : null}
          </header>

          {!hasMessages ? <SuggestionGrid onSelect={(value) => ask(undefined, value)} /> : null}

          <div className={styles.messages} aria-live="polite">
            {messages.map((message) => (
              <article
                key={message.id}
                className={[styles.message, message.role === 'user' ? styles.userMessage : styles.assistantMessage, message.isError ? styles.errorMessage : ''].filter(Boolean).join(' ')}
              >
                <div className={styles.messageLabel}>{message.role === 'user' ? 'You' : 'AI'}</div>
                <MarkdownContent content={message.content} />
                {message.citations?.length ? <CitationList citations={message.citations} /> : null}
              </article>
            ))}
            {isLoading ? (
              <article className={[styles.message, styles.assistantMessage].join(' ')}>
                <div className={styles.messageLabel}>AI</div>
                <p>Searching the docs...</p>
              </article>
            ) : null}
          </div>

          <form className={styles.form} onSubmit={ask}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about these docs..."
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

function SuggestionGrid({onSelect}: {onSelect: (question: string) => void}) {
  return (
    <div className={styles.suggestions}>
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.question}
          type="button"
          className={styles.suggestion}
          onClick={() => onSelect(suggestion.question)}
        >
          <span>{suggestion.label}</span>
          <strong>{suggestion.question}</strong>
        </button>
      ))}
    </div>
  );
}

async function requestAnswer({
  previousInteractionId,
  question,
}: {
  previousInteractionId?: string;
  question: string;
}): Promise<ApiResponse> {
  const response = await fetch(apiPath, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({previousInteractionId, question}),
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json() as ApiResponse
    : {};

  if (response.status === 403 && data.captchaRequired) {
    throw new Error('Verification is required. Add Turnstile support to this copied page before enabling captcha.');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Gemini Search is unavailable right now.');
  }

  return data;
}

function CitationList({citations}: {citations: Citation[]}) {
  return (
    <div className={styles.citations}>
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
  return <div className={styles.markdown}>{tokens.map((token, index) => renderMarkdownBlock(token, index))}</div>;
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
