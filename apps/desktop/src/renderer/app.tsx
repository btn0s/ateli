import { useState } from "react"
import { Agentation } from "agentation"
import { FolderPicker } from "@/components/folder-picker"
import { Canvas } from "@/components/canvas"
import { Titlebar } from "@/components/titlebar"
import { ManagementPolicyProvider } from "@/contexts/management-policy-context"
import { TerminalSessionProvider } from "@/contexts/terminal-session-store"

const FOLDER_KEY = "ateli:folder-path"

export function App() {
  const [folderPath, setFolderPath] = useState<string | null>(() =>
    localStorage.getItem(FOLDER_KEY)
  )

  function handleSelect(path: string) {
    localStorage.setItem(FOLDER_KEY, path)
    setFolderPath(path)
  }

  return (
    <>
      {process.env.NODE_ENV === "development" && (
        <Agentation endpoint="http://localhost:4747" />
      )}
      <Titlebar />
      <ManagementPolicyProvider>
        <TerminalSessionProvider>
          {folderPath ? (
            <Canvas folderPath={folderPath} />
          ) : (
            <FolderPicker onSelect={handleSelect} />
          )}
        </TerminalSessionProvider>
      </ManagementPolicyProvider>
    </>
  )
}
