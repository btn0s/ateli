import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

export type ManagementPolicy = Awaited<
  ReturnType<typeof window.electron.management.getPolicy>
>

type ManagementPolicyContextValue = {
  policy: ManagementPolicy
  updatePolicy: (
    patch: Parameters<typeof window.electron.management.updatePolicy>[0]
  ) => Promise<ManagementPolicy>
}

const ManagementPolicyContext =
  createContext<ManagementPolicyContextValue | null>(null)

function defaultPolicy(): ManagementPolicy {
  return {
    version: 1,
    user: {
      renameTerminal: true,
      renameBranch: true,
    },
    agent: {
      renameTerminal: true,
      renameBranch: true,
    },
  }
}

export function ManagementPolicyProvider({
  children,
}: {
  children: ReactNode
}) {
  const [policy, setPolicy] = useState<ManagementPolicy>(() => defaultPolicy())

  const refresh = useCallback(() => {
    void window.electron.management.getPolicy().then(setPolicy)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    return window.electron.rpc.onNotification(({ method, params }) => {
      if (method !== "management.policy.updated") return
      const nextPolicy = params.policy
      if (!nextPolicy || typeof nextPolicy !== "object") return
      setPolicy(nextPolicy as ManagementPolicy)
    })
  }, [])

  const updatePolicy = useCallback(
    async (
      patch: Parameters<typeof window.electron.management.updatePolicy>[0]
    ) => {
      const next = await window.electron.management.updatePolicy(patch)
      setPolicy(next)
      return next
    },
    []
  )

  return (
    <ManagementPolicyContext.Provider value={{ policy, updatePolicy }}>
      {children}
    </ManagementPolicyContext.Provider>
  )
}

export function useManagementPolicy() {
  const value = useContext(ManagementPolicyContext)
  if (!value) {
    throw new Error(
      "useManagementPolicy must be used within ManagementPolicyProvider"
    )
  }
  return value
}
