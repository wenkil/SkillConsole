import { Type, type Static } from "typebox"

export const LivenessResponseSchema = Type.Object(
  {
    service: Type.Literal("skillconsole-server"),
    status: Type.Literal("alive"),
  },
  { additionalProperties: false },
)

export const ReadinessResponseSchema = Type.Object(
  {
    service: Type.Literal("skillconsole-server"),
    status: Type.Union([
      Type.Literal("ready"),
      Type.Literal("unavailable"),
    ]),
    checks: Type.Object(
      {
        database: Type.Union([
          Type.Literal("connected"),
          Type.Literal("unavailable"),
        ]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export type LivenessResponse = Static<typeof LivenessResponseSchema>
export type ReadinessResponse = Static<typeof ReadinessResponseSchema>
