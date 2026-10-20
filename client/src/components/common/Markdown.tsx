import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

// Raw HTML in the source is not rendered (react-markdown default), so notes can't inject markup
const components: Components = {
  h1: ({ children }) => <h3 className="mt-6 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-6 text-base font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-5 text-sm font-semibold first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="mt-3 leading-6 first:mt-0">{children}</p>,
  ul: ({ children }) => <ul className="mt-3 list-disc space-y-1.5 pl-5 marker:text-muted-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1.5 pl-5 marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="leading-6">{children}</li>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">{children}</a>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  code: ({ children }) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>,
  pre: ({ children }) => <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="mt-3 border-l-2 border-primary/50 bg-muted/50 py-2 pr-3 pl-4 text-foreground [&_p]:mt-0">{children}</blockquote>,
  hr: () => <hr className="my-5 border-border" />,
  table: ({ children }) => <div className="mt-3 overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm">{children}</table></div>,
  thead: ({ children }) => <thead className="bg-muted/60 text-xs text-muted-foreground">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-2 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-t px-3 py-2">{children}</td>,
}

export function Markdown({ children }: { children: string }) {
  return <div className="text-sm text-muted-foreground"><ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown></div>
}
