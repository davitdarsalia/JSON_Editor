import { FC } from "react";

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
  onBeautify: () => void;
}

export const Header: FC<HeaderProps> = ({
  searchQuery,
  onSearchChange,
  onSearchFocus,
  onSearchBlur,
  onBeautify,
}) => (
  <div
    className="app-header"
    // @ts-ignore — Tauri-specific WebKit drag region
    style={{ WebkitAppRegion: "drag" }}
  >
    <div className="header-actions">
      <button className="icon-btn" onClick={onBeautify} title="Beautify JSON (⌘⇧F)">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z" />
          <path d="m14 7 3 3" />
          <path d="M5 6v4" />
          <path d="M19 14v4" />
          <path d="M10 2v2" />
          <path d="M7 8H3" />
          <path d="M21 16h-4" />
          <path d="M11 3H9" />
        </svg>
      </button>
    </div>

    <div className="search-bar">
      <input
        className="search-input"
        type="search"
        placeholder="Search JSON…"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onFocus={onSearchFocus}
        onBlur={() => {
          if (!searchQuery.trim()) onSearchBlur();
        }}
      />
    </div>
  </div>
);
