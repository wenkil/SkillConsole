import { Type, type Static } from "typebox"

const AgentSessionStatusSchema = Type.Union([
  Type.Literal("STARTING"),
  Type.Literal("RUNNING"),
  Type.Literal("IDLE"),
  Type.Literal("CANCELING"),
  Type.Literal("INTERRUPTED"),
  Type.Literal("FAILED"),
])
const AgentSessionTurnStatusSchema = Type.Union([
  Type.Literal("RUNNING"),
  Type.Literal("COMPLETED"),
  Type.Literal("CANCELED"),
  Type.Literal("INTERRUPTED"),
  Type.Literal("FAILED"),
])
const AgentSessionEventTypeSchema = Type.Union([
  Type.Literal("session.started"),
  Type.Literal("turn.started"),
  Type.Literal("assistant.message"),
  Type.Literal("tool.completed"),
  Type.Literal("usage.updated"),
  Type.Literal("turn.completed"),
  Type.Literal("turn.canceled"),
  Type.Literal("turn.interrupted"),
  Type.Literal("turn.failed"),
  Type.Literal("session.failed"),
])

const AgentSessionErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

export const AgentMessageInputSchema = Type.Object(
  {
    prompt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

export const AgentSessionParamsSchema = Type.Object(
  {
    sessionId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
)

export const AgentSessionTurnSummarySchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    status: AgentSessionTurnStatusSchema,
    error: Type.Union([AgentSessionErrorSchema, Type.Null()]),
    startedAt: Type.String({ format: "date-time" }),
    completedAt: Type.Union([
      Type.String({ format: "date-time" }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
)

export const AgentSessionSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    status: AgentSessionStatusSchema,
    resumable: Type.Boolean(),
    latestTurn: Type.Union([AgentSessionTurnSummarySchema, Type.Null()]),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
)

export const AgentSessionEventSchema = Type.Object(
  {
    sequence: Type.Integer({ minimum: 1 }),
    type: AgentSessionEventTypeSchema,
    sessionId: Type.String({ format: "uuid" }),
    turnId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    occurredAt: Type.String({ format: "date-time" }),
    payload: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
)

export const AgentSessionEventsHeaderSchema = Type.Object(
  {
    "last-event-id": Type.Optional(
      Type.String({ pattern: "^(0|[1-9][0-9]*)$" }),
    ),
  },
  { additionalProperties: true },
)

export type AgentMessageInput = Static<typeof AgentMessageInputSchema>
