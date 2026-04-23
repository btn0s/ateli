export function Titlebar() {
  return (
    <div
      className="fixed inset-x-0 top-0 z-[999] h-12"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    />
  )
}
