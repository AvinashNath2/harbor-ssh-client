/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#f5f4f0",
          titlebar: "#edecea",
          sidebar: "#eeecea",
          toolbar: "#f8f7f4",
          colheader: "#f2f0eb",
          pane: "#ffffff",
          chip: "#e8e6e0",
          hover: "#eef2fb",
          sidebarHover: "#e5e2dc",
          input: "#fafaf9",
        },
        border: {
          DEFAULT: "#e0ddd6",
          raised: "#e8e5de",
          input: "#dedad2",
          subtle: "#f0ede8",
        },
        text: {
          primary: "#26282d",
          secondary: "#6a6f7a",
          tertiary: "#8a8578",
          faint: "#b0ab9e",
          heading: "#1c3f7a",
          accent: "#3f6aae",
        },
        accent: {
          DEFAULT: "#3f7be0",
          dark: "#2f6bdb",
          muted: "#8fb4e8",
        },
        success: "#1f9d63",
        warning: "#e0a53c",
        danger: "#d64545",
        offline: "#c9c4b8",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["'JetBrains Mono'", "'Fira Code'", "ui-monospace", "monospace"],
      },
      spacing: {
        18: "4.5rem",
      },
      borderRadius: {
        input: "9px",
        chip: "6px",
        modal: "18px",
        lg: "12px",
        xl: "16px",
      },
      boxShadow: {
        soft: "0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.04)",
        md: "0 4px 12px -2px rgba(0,0,0,0.08), 0 2px 6px -2px rgba(0,0,0,0.05)",
        modal: "0 20px 60px -10px rgba(0,0,0,0.25), 0 8px 24px -8px rgba(0,0,0,0.12)",
      },
    },
  },
  plugins: [],
};
