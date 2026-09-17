// Where the document script reaches the machine. One backend (backend.mjs, kept alive by launchd) serves every
// route; Agentation's feedback server is a child of it on its own port because its MCP client binds there too.
export const backendUrl = 'http://127.0.0.1:7237'
export const feedbackUrl = 'http://127.0.0.1:4748'
