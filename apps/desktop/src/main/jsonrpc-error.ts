const INVALID_PARAMS = -32602

export class RpcInvalidParamsError extends Error {
  readonly code = INVALID_PARAMS
  override readonly name = "RpcInvalidParamsError"
  constructor(message: string) {
    super(message)
  }
}

export function isRpcInvalidParams(
  err: unknown
): err is RpcInvalidParamsError {
  return err instanceof RpcInvalidParamsError
}
