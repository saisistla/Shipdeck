export function PolicyMark({ id }: { id: string }) {
  switch (id) {
    case "python":
    case "https://pypi.org":
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r="24" fill="#fff" />
          <path
            fill="#3776AB"
            d="M24.1 6c-5.5 0-5.1 2.4-5.1 2.4v2.5h5.2v.8h-8.8S8 11 8 18.4s3.9 6.4 3.9 6.4h2.3v-3.1s-.1-3.7 3.6-3.7h6.3c3.2 0 2.9-2 2.9-2V8.5S27.8 6 24.1 6zm-3 2.3a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z"
          />
          <path
            fill="#FFD43B"
            d="M23.9 42c5.5 0 5.1-2.4 5.1-2.4v-2.5h-5.2v-.8h8.8s7.3.8 7.3-6.7-3.9-6.4-3.9-6.4h-2.3v3.1s.1 3.7-3.6 3.7h-6.3c-3.2 0-2.9 2-2.9 2v8.3S20.2 42 23.9 42zm3-2.3a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z"
          />
        </svg>
      );
    case "node":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="#539E43" d="M16 2.2 4 9.1v13.8L16 29.8l12-6.9V9.1z" />
          <path fill="#fff" d="M16 7.4c3.6 0 5.4 1.9 5.4 5.7v.7h-2.4v-.6c0-2.2-.8-3.2-3-3.2s-3 .9-3 3.1c0 1.2.4 2 2.1 2.5l1.6.5c2.8.8 4.1 2 4.1 4.4 0 2.9-1.8 4.6-5.3 4.6-3.6 0-5.5-1.8-5.5-5.5v-1h2.5v.9c0 2.3 1 3.3 3.1 3.3s2.9-1 2.9-2.8c0-1.2-.5-2-2.1-2.5l-1.6-.5c-2.7-.8-4-2.1-4-4.5 0-3 1.8-4.6 5.2-4.6z" />
        </svg>
      );
    case "javascript":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="#F7DF1E" d="M4 4h24v24H4z" />
          <path d="M19.3 23.1c.4.7.8 1.3 1.8 1.3 1 0 1.6-.4 1.6-1.9v-8.2h2.5v8.3c0 2.6-1.5 3.8-3.7 3.8-2 0-3.1-1-3.7-2.3zm-7.4.2c.3.5.6 1 1.3 1 .7 0 1.1-.3 1.1-1.3v-8.7h2.5v8.8c0 2.6-1.5 3.7-3.6 3.7-1.9 0-3-1.1-3.6-2.3z" />
        </svg>
      );
    case "typescript":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="#3178C6" d="M4 4h24v24H4z" />
          <path fill="#fff" d="M18.4 16.4h-2.4v8.1h-2.2v-8.1H11.4v-1.9h7zM25.2 22.3c-.4.8-1 1.4-2.1 1.4-1.4 0-2.3-.7-2.3-2.4v-3.6h2.1v3.4c0 .7.3 1.1 1 1.1.6 0 1-.3 1.2-1l.1.1z" />
        </svg>
      );
    case "go":
    case "https://proxy.golang.org":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#00ADD8" />
          <path fill="#fff" d="M8.2 17.6c.2.1.4 0 .5-.1l.2-.4c.1-.3 0-.4-.2-.5-1.1-.7-1.8-1.8-1.8-3 0-2.1 1.8-3.8 4-3.8 1.4 0 2.6.7 3.3 1.8l.3.4c.1.2.3.2.5.1l1.6-.6c.2-.1.3-.3.2-.5-.8-1.9-2.7-3.2-4.9-3.2-3.1 0-5.6 2.4-5.6 5.4 0 1.9 1 3.6 2.6 4.6.2.1.4.1.3-.2zm7.6-6.8c0-.3.2-.5.5-.5h6.6c.3 0 .5.2.5.5v1.1c0 .3-.2.5-.5.5h-6.6c-.3 0-.5-.2-.5-.5zm.8 3.3c0-.3.2-.5.5-.5h4.8c.3 0 .5.2.5.5v1.1c0 .3-.2.5-.5.5h-4.8c-.3 0-.5-.2-.5-.5z" />
        </svg>
      );
    case "java":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#E76F00" />
          <path fill="#fff" d="M16.7 6.4s-1.3 1.4.9 3.6c0 0 .9 1-1.3 1.9 0 0 4.3-1.1 2.4-4.8-.5-1.1-1.3-1.1-2 0-.7.8.2 1.3 0-.7zm-2.8 5.3s-4.5 2.7 0 5.8c0 0 .7.5 1.6-.6.8-1 1.6-2 .2-3.4-1.2-1.2-1.8-1.8-1.8-1.8zm6.2 1.1s.6 3.3-3.4 4.6c0 0-1.7.6.3 1.3 0 0 4.8 1.5 4.8-2.7 0-2.1-1.7-3.2-1.7-3.2zM12.4 19s4.8 3-2.1 4.1c0 0-.9.3 2.6 1.6 3.7 1.4 8.5-.5 8.1-2.6-.4-2.1-4.6-1.6-8.6-3.1z" />
        </svg>
      );
    case "csharp":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#68217A" />
          <path fill="#fff" d="M13.4 21.6c-3 0-5.2-2.3-5.2-5.6s2.2-5.6 5.2-5.6c1.6 0 2.8.6 3.7 1.7l-1.6 1.3c-.5-.6-1.2-1-2.1-1-1.7 0-2.9 1.4-2.9 3.6s1.2 3.6 2.9 3.6c.9 0 1.6-.4 2.1-1l1.6 1.3c-.9 1.1-2.1 1.7-3.7 1.7zm7.2-7.4h1.6v1.3h1.4v-1.3h1.6v1.3h1.3v1.5h-1.3v1.3h1.3v1.5h-1.3V20h-1.6v-1.2h-1.4V20h-1.6v-1.2h-1.3v-1.5h1.3v-1.3h-1.3v-1.5h1.3zm1.6 2.8v1.3h1.4v-1.3z" />
        </svg>
      );
    case "ruby":
    case "https://rubygems.org":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="#CC342D" d="M16 3 5 12.4 16 29l11-16.6z" />
          <path fill="#fff" opacity=".28" d="M16 3 5 12.4h22z" />
        </svg>
      );
    case "php":
    case "https://repo.packagist.org":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <ellipse cx="16" cy="16" rx="14" ry="9" fill="#777BB4" />
          <path fill="#fff" d="M10.4 13.2h2.2c1.6 0 2.3.6 2.1 1.9l-.7 3.7h-1.7l.6-3.3c.1-.6-.1-.8-.7-.8h-.7l-.8 4.1H9.1zm6.4 0h1.7l-.3 1.6h1.5c1.5 0 2.1.6 1.9 1.8l-.5 2.2h-1.7l.4-2.1c.1-.6-.1-.8-.7-.8h-1.3l-.6 2.9h-1.7zm6.7 0h2.2c1.6 0 2.3.6 2.1 1.9l-.7 3.7h-1.7l.6-3.3c.1-.6-.1-.8-.7-.8h-.7l-.8 4.1H21.8z" />
        </svg>
      );
    case "rust":
    case "https://crates.io":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="13" fill="#000" />
          <circle cx="16" cy="16" r="8" fill="none" stroke="#F74C00" strokeWidth="2.2" />
          <circle cx="16" cy="16" r="3.2" fill="#F74C00" />
        </svg>
      );
    case "https://registry.npmjs.org":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="#CB3837" d="M4 4h24v24H4z" />
          <path fill="#fff" d="M8 8h16v16H16V12h-4v12H8z" />
        </svg>
      );
    case "https://repo.maven.apache.org/maven2":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#C71A36" />
          <path fill="#fff" d="M8 22 16 8l8 14h-3.2L16 13.4 11.2 22z" />
        </svg>
      );
    case "https://api.nuget.org/v3/index.json":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#004880" />
          <circle cx="11" cy="12" r="3" fill="#fff" />
          <circle cx="20" cy="20" r="5" fill="#fff" />
        </svg>
      );
    case "MIT":
    case "ISC":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#2F6EAC" />
          <path fill="#fff" d="M10 8h12v16H10z" />
          <path fill="#2F6EAC" d="M12 11h8v1.4h-8zm0 3h8v1.4h-8zm0 3h6v1.4h-6z" />
        </svg>
      );
    case "Apache-2.0":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#D22128" />
          <path fill="#fff" d="M16 7 9 25h3.2l1.3-3.6h5l1.3 3.6H23L16 7zm0 5.2 1.8 5h-3.6z" />
        </svg>
      );
    case "BSD-3-Clause":
    case "BSD-2-Clause":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#AB2020" />
          <circle cx="16" cy="14" r="5" fill="#F4C430" />
          <path fill="#F4C430" d="M11 20h10l-1.4 6H12.4z" />
        </svg>
      );
    case "GPL-3.0":
    case "LGPL-3.0":
    case "AGPL-3.0":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#A51E22" />
          <path fill="#fff" d="M16 7c-3.8 0-6.5 2.6-6.5 6.2 0 2.3 1.2 4.1 3 5.1L11 25h10l-1.5-6.7c1.8-1 3-2.8 3-5.1C22.5 9.6 19.8 7 16 7zm-2.2 5.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zm4.4 0a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z" />
        </svg>
      );
    case "MPL-2.0":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#1B4F8A" />
          <path fill="#F4C430" d="M8 22c2-5 5-9 8-9s6 4 8 9H8z" />
          <circle cx="13" cy="16" r="1.2" fill="#122033" />
          <circle cx="19" cy="16" r="1.2" fill="#122033" />
        </svg>
      );
    case "Unlicense":
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="12" fill="#15803d" />
          <path fill="#fff" d="M10 16a6 6 0 1 1 12 0 6 6 0 0 1-12 0zm6-4.2A4.2 4.2 0 0 0 11.8 16h8.4A4.2 4.2 0 0 0 16 11.8z" />
        </svg>
      );
    default:
      return <span>{id.slice(0, 2)}</span>;
  }
}
