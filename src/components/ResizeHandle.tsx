interface ResizeHandleProps {
  axis: "x" | "y";
  onMouseDown: (e: React.MouseEvent) => void;
  title?: string;
}

/**
 * A thin invisible strip that gets a colored highlight on hover / drag.
 * Sit it between two flex children (or absolutely position on the edge of a panel).
 */
export function ResizeHandle({ axis, onMouseDown, title }: ResizeHandleProps) {
  const isX = axis === "x";
  return (
    <div
      role="separator"
      title={title}
      onMouseDown={onMouseDown}
      className="group flex-shrink-0 transition-colors"
      style={{
        width: isX ? 5 : undefined,
        height: isX ? undefined : 5,
        cursor: isX ? "col-resize" : "row-resize",
        background: "transparent",
        alignSelf: isX ? "stretch" : undefined,
      }}
    >
      <div
        className="h-full w-full transition-colors"
        style={{
          background: "transparent",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(63,123,224,0.35)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      />
    </div>
  );
}
