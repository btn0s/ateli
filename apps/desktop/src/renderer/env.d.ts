interface Window {
  electron: {
    platform: string
    selectFolder: () => Promise<string | null>
  }
}
