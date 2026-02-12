import ReactMarkdown from 'react-markdown'

interface MarkdownProps {
  children: string
  className?: string
}

export function Markdown({ children, className = '' }: MarkdownProps) {
  return (
    <ReactMarkdown
      className={`markdown ${className}`}
      components={{
        p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="my-1 ml-4 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="my-1 ml-4 list-decimal">{children}</ol>,
        li: ({ children }) => <li className="my-0.5">{children}</li>,
        h1: ({ children }) => <h1 className="my-2 text-lg font-semibold">{children}</h1>,
        h2: ({ children }) => <h2 className="my-2 text-base font-semibold">{children}</h2>,
        h3: ({ children }) => <h3 className="my-1.5 text-sm font-semibold">{children}</h3>,
        code: ({ className, children }) => {
          const isBlock = className?.includes('language-')
          if (isBlock) {
            return (
              <pre className="my-2 overflow-x-auto rounded-md bg-[#1c2129] p-2">
                <code className="text-xs">{children}</code>
              </pre>
            )
          }
          return (
            <code className="rounded bg-[#1c2129] px-1 py-0.5 text-xs">{children}</code>
          )
        },
        pre: ({ children }) => <>{children}</>,
        a: ({ href, children }) => (
          <a href={href} className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        strong: ({ children }) => <strong className="font-semibold text-gray-200">{children}</strong>,
        em: ({ children }) => <em className="text-gray-300">{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-gray-600 pl-3 text-gray-400">{children}</blockquote>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  )
}
