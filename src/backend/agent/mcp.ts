// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-mcp>>[init]
import * as z from "zod";

/** What a tool sees of the request that called it. */
export interface ToolContext {
  /** Where the reader opens a path of this server's. */
  origin: string;
}

export interface Tool<Input extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  input: Input;
  /** The answer as text. A thrown `ToolError` is shown to the agent as a
   *  failed call; anything else thrown is a fault of the server. */
  call: (input: z.infer<Input>, context: ToolContext) => Promise<string>;
}

/** A call the agent can correct, said in words it can act on. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function tool<Input extends z.ZodObject>(definition: Tool<Input>): Tool {
  return definition as unknown as Tool;
}

// Newest first; a client asking for another is answered with the newest,
// which the protocol leaves it to accept or hang up on.
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

const Message = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const CallParams = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

type Answer =
  | { result: unknown }
  | { error: { code: number; message: string } };

async function answer(
  method: string,
  params: Record<string, unknown>,
  tools: Tool[],
  instructions: string,
  context: ToolContext,
): Promise<Answer> {
  switch (method) {
    case "initialize": {
      const asked = params.protocolVersion;
      return {
        result: {
          protocolVersion:
            typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked)
              ? asked
              : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "diffy", version: "0" },
          instructions,
        },
      };
    }
    case "ping":
      return { result: {} };
    case "tools/list":
      return {
        result: {
          tools: tools.map((each) => ({
            name: each.name,
            description: each.description,
            inputSchema: z.toJSONSchema(each.input, { io: "input" }),
          })),
        },
      };
    case "tools/call": {
      const call = CallParams.safeParse(params);
      const found = call.success
        ? tools.find((each) => each.name === call.data.name)
        : undefined;
      if (!call.success || found === undefined) {
        return { error: { code: -32602, message: "no such tool" } };
      }
      const input = found.input.safeParse(call.data.arguments);
      try {
        if (!input.success) throw new ToolError(z.prettifyError(input.error));
        const text = await found.call(input.data, context);
        return { result: { content: [{ type: "text", text }] } };
      } catch (error) {
        if (!(error instanceof ToolError)) throw error;
        return {
          result: {
            content: [{ type: "text", text: error.message }],
            isError: true,
          },
        };
      }
    }
    default:
      return { error: { code: -32601, message: `no method ${method}` } };
  }
}

export function mcpRoute(
  tools: Tool[],
  instructions: string,
  origin: (req: Request) => string,
) {
  const refuse = () =>
    new Response("only POST", { status: 405, headers: { Allow: "POST" } });
  return {
    GET: refuse,
    DELETE: refuse,
    POST: async (req: Request) => {
      const message = Message.safeParse(await req.json().catch(() => null));
      if (!message.success || message.data.method === undefined) {
        // A notification or a response needs no answer, and a client sends
        // nothing else without a method.
        return message.success
          ? new Response(null, { status: 202 })
          : Response.json(
              {
                jsonrpc: "2.0",
                id: null,
                error: { code: -32700, message: "not a JSON-RPC message" },
              },
              { status: 400 },
            );
      }
      const { id, method, params = {} } = message.data;
      if (id === undefined) return new Response(null, { status: 202 });
      const context = { origin: origin(req) };
      return Response.json({
        jsonrpc: "2.0",
        id,
        ...(await answer(method, params, tools, instructions, context)),
      });
    },
  };
}
// ~/~ end
