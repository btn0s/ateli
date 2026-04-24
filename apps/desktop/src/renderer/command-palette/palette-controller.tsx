import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type { PaletteRoute } from "./types"
import { ROOT_ROUTE } from "./view-state"

export type PaletteController = {
  isOpen: boolean
  initialRoute: PaletteRoute
  open: () => void
  openRoute: (route: PaletteRoute) => void
  close: () => void
}

const PaletteControllerCtx = createContext<PaletteController | null>(null)

export function PaletteControllerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ isOpen: boolean; initialRoute: PaletteRoute }>({
    isOpen: false,
    initialRoute: ROOT_ROUTE,
  })

  const open = useCallback(() => {
    setState({ isOpen: true, initialRoute: ROOT_ROUTE })
  }, [])

  const openRoute = useCallback((route: PaletteRoute) => {
    setState({ isOpen: true, initialRoute: route })
  }, [])

  const close = useCallback(() => {
    setState((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev))
  }, [])

  const controller = useMemo<PaletteController>(
    () => ({
      isOpen: state.isOpen,
      initialRoute: state.initialRoute,
      open,
      openRoute,
      close,
    }),
    [close, open, openRoute, state.initialRoute, state.isOpen],
  )

  return (
    <PaletteControllerCtx.Provider value={controller}>
      {children}
    </PaletteControllerCtx.Provider>
  )
}

export function usePaletteController(): PaletteController {
  const controller = useContext(PaletteControllerCtx)
  if (!controller) {
    throw new Error("usePaletteController must be used inside PaletteControllerProvider")
  }
  return controller
}
