import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface TextOutputProps {
  content: string;
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-bold text-zinc-100 mt-8 mb-4">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold text-zinc-100 mt-8 mb-3">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-semibold text-zinc-200 mt-6 mb-3">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-medium text-zinc-200 mt-5 mb-2">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="text-zinc-300 leading-relaxed my-4">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 my-4 space-y-2 text-zinc-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 my-4 space-y-2 text-zinc-300">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-zinc-300 leading-relaxed">{children}</li>
  ),
  pre: ({ children }) => (
    <pre className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 my-5 overflow-x-auto text-sm">{children}</pre>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return <code className={`${className} text-zinc-300`}>{children}</code>;
    }
    return (
      <code className="bg-zinc-800 text-blue-300 px-1.5 py-0.5 rounded text-sm">{children}</code>
    );
  },
  hr: () => <hr className="border-zinc-800 my-8" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-zinc-700 pl-4 my-4 text-zinc-400 italic">{children}</blockquote>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-zinc-100">{children}</strong>
  ),
  a: ({ children, href }) => (
    <a href={href} className="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer">{children}</a>
  ),
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto">
      <table className="min-w-full border-collapse border border-zinc-800 text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-zinc-200 font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-zinc-800 px-3 py-2 text-zinc-300">{children}</td>
  ),
};

export function TextOutput({ content }: TextOutputProps) {
  return (
    <div className="max-w-none [&>:first-child]:!mt-0 [&>:last-child]:!mb-0">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </div>
  );
}
