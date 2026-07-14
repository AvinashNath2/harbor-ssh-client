/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#f6f5f1",
          titlebar: "#eceae4",
          sidebar: "#efede8",
          toolbar: "#faf9f6",
          colheader: "#f2f0eb",
          pane: "#ffffff",
          chip: "#eceae4",
          hover: "#f0f4fb",
          sidebarHover: "#e8e5de",
        },
        border: {
          DEFAULT: "#dcd8d0",
          raised: "#e6e2da",
          input: "#e0dcd3",
          subtle: "#f4f2ee",
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
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        input: "9px",
        chip: "6px",
        modal: "16px",
      },
    },
  },
  plugins: [],
};
